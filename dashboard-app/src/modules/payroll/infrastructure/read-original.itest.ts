import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { auditEvents, organizations, users } from "@/lib/db/schema";
import { permissionsForRoles } from "@/platform/auth/permissions";
import type { Principal } from "@/platform/auth/principal";
import { withSystemContext, withUserContext } from "@/platform/db/context";
import { closeDb, resetDb, testDb } from "@/test/db";
import type { DocumentStore, MalwareScanner } from "../application/ports";
import { uploadPayslip } from "./upload";
import { scanImport } from "./ingest";
import { payrollDeps } from "./deps";
import { noopScanner } from "./noop-scanner";
import { resolveDocumentStore } from "./document-store-resolver";
import { readOriginal } from "./read-original";

const pdf = (extra = "") => new TextEncoder().encode(`%PDF-1.7\n${extra}`);

const NOOP_STORE: DocumentStore = {
  provider: "local",
  put: async () => {},
  get: async () => null,
  delete: async () => {},
  listPrefix: async () => [],
};

async function seedPrincipal(): Promise<Principal> {
  const db = await testDb();
  const [org] = await db.insert(organizations).values({ name: "P" }).returning();
  const [user] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
  const roles = ["owner"] as const;
  return { userId: user!.id, organizationId: org!.id, roles: [...roles], permissions: permissionsForRoles([...roles]) };
}

async function aCleanImport(principal: Principal, fileName = "Busta Paga Agosto 2026.pdf") {
  const uploaded = await uploadPayslip(principal, { fileName, mime: "application/pdf", bytes: pdf("body") });
  const clean: MalwareScanner = { scan: async () => ({ verdict: "clean", scanner: "none", signature: null }) };
  await scanImport(principal, uploaded.id, { scanner: clean });
  return uploaded;
}

/**
 * A call-order sanity check, **not** a proof of transaction isolation.
 *
 * This records, at the instant `get` is called, whether the audit row
 * `recordOriginalRead` writes already exists. That can only ever come back
 * `false`, in both the correct code and a regressed one that merged
 * everything into a single `withUserContext` block: `recordOriginalRead` is
 * called with the readiness data as an argument, so in plain program order it
 * always runs *after* `documents.get` returns, whether or not the two DB
 * calls share a transaction. So this check has no power to distinguish "two
 * short transactions with the fetch sandwiched between them" from "one
 * transaction spanning the whole call" — it only confirms the audit write
 * is not somehow issued before the bytes are fetched, which is a much weaker
 * claim than transaction isolation.
 *
 * The actual transaction-boundary guarantee is not something a test like this
 * can observe from outside; it comes from the orchestrator's code structure
 * itself (`infrastructure/read-original.ts`): `beginReadOriginal`'s
 * `withUserContext` call returns — and that transaction commits — before
 * `documents.get` is ever reached, and `recordOriginalRead`'s
 * `withUserContext` call opens a fresh transaction afterward. That is
 * verifiable by inspection, not by a runtime probe; proving it at runtime
 * would need something like a `pg_stat_activity` idle-in-transaction check,
 * which is not worth the added flakiness here.
 */
function orderObservingStore(inner: DocumentStore, importId: string): { store: DocumentStore; auditRowExistedAtFetchTime: () => boolean | undefined } {
  let auditRowExistedAtFetchTime: boolean | undefined;
  const store: DocumentStore = {
    provider: inner.provider,
    put: inner.put.bind(inner),
    delete: inner.delete.bind(inner),
    listPrefix: inner.listPrefix.bind(inner),
    get: async (key) => {
      const db = await testDb();
      const rows = await withSystemContext(db, (tx) =>
        tx
          .select({ id: auditEvents.id })
          .from(auditEvents)
          .where(and(eq(auditEvents.entityId, importId), eq(auditEvents.action, "payroll.original_read"))),
      );
      auditRowExistedAtFetchTime = rows.length > 0;
      return inner.get(key);
    },
  };
  return { store, auditRowExistedAtFetchTime: () => auditRowExistedAtFetchTime };
}

describe("readOriginal", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("streams the bytes with the stored filename and mime, and audits the read", async () => {
    const principal = await seedPrincipal();
    const uploaded = await aCleanImport(principal);

    const original = await readOriginal(principal, uploaded.id);
    expect(original).toEqual({ bytes: pdf("body"), mime: "application/pdf", fileName: uploaded.fileName });

    const db = await testDb();
    const rows = await withUserContext(db, { userId: principal.userId }, (tx) =>
      tx
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.entityId, uploaded.id), eq(auditEvents.action, "payroll.original_read"))),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.after).toEqual({ sha256: uploaded.sha256, sizeBytes: uploaded.sizeBytes });
  });

  it("calls recordOriginalRead only after the document fetch returns (call-order sanity check — see orderObservingStore's doc comment for what this does and does not prove)", async () => {
    const principal = await seedPrincipal();
    const uploaded = await aCleanImport(principal);
    const resolution = await resolveDocumentStore(principal.userId);
    const { store, auditRowExistedAtFetchTime } = orderObservingStore(resolution!.store, uploaded.id);

    await readOriginal(principal, uploaded.id, { documents: store });
    expect(auditRowExistedAtFetchTime()).toBe(false);

    const db = await testDb();
    const rows = await withUserContext(db, { userId: principal.userId }, (tx) =>
      tx
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.entityId, uploaded.id), eq(auditEvents.action, "payroll.original_read"))),
    );
    expect(rows).toHaveLength(1);
  });

  it("refuses an import that has not cleared the scanner, with a conflict (Ruling R4-2)", async () => {
    const principal = await seedPrincipal();
    const uploaded = await uploadPayslip(principal, { fileName: "a.pdf", mime: "application/pdf", bytes: pdf("body") });

    await expect(readOriginal(principal, uploaded.id)).rejects.toMatchObject({ name: "ConflictError", reason: "not_scanned" });
  });

  it("refuses a purged original with a conflict naming retention, not a 404 (Ruling R4-5)", async () => {
    const principal = await seedPrincipal();
    const uploaded = await aCleanImport(principal);
    const db = await testDb();
    await withUserContext(db, { userId: principal.userId }, (tx) =>
      payrollDeps(tx, { documents: NOOP_STORE, scanner: noopScanner }).imports.patch(principal.userId, uploaded.id, {
        storageKey: null,
        purgedAt: new Date(),
      }),
    );

    await expect(readOriginal(principal, uploaded.id)).rejects.toMatchObject({ name: "ConflictError", reason: "purged" });
  });

  it("reports a store that has lost the object as a conflict, not as clean bytes", async () => {
    const principal = await seedPrincipal();
    const uploaded = await aCleanImport(principal);
    const resolution = await resolveDocumentStore(principal.userId);
    await resolution!.store.delete(uploaded.storageKey!);

    await expect(readOriginal(principal, uploaded.id)).rejects.toMatchObject({ name: "ConflictError", reason: "bytes_missing" });
  });

  it("throws NotFoundError for another user's import", async () => {
    const principal = await seedPrincipal();
    const other = await seedPrincipal();
    const uploaded = await aCleanImport(principal);

    await expect(readOriginal(other, uploaded.id)).rejects.toThrow(/not found/i);
  });
});
