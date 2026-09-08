import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { organizations, users } from "@/lib/db/schema";
import { permissionsForRoles } from "@/platform/auth/permissions";
import type { Principal } from "@/platform/auth/principal";
import { withUserContext } from "@/platform/db/context";
import { closeDb, resetDb, testDb } from "@/test/db";
import type { DocumentStore, PayrollImport, PayrollImportStatus } from "../application/ports";
import { LIVE_STATUSES } from "../domain/payroll";
import { PURGE_BATCH, purgeExpiredOriginals } from "./purge-expired-originals";
import { payrollDeps } from "./deps";
import { noopScanner } from "./noop-scanner";
import { resolveDocumentStore } from "./document-store-resolver";

const NOW = new Date("2026-09-05T10:00:00Z");
const PAST = new Date("2020-01-01T00:00:00Z");
const FUTURE = new Date("2036-01-01T00:00:00Z");

async function seedPrincipal(): Promise<Principal> {
  const db = await testDb();
  const [org] = await db.insert(organizations).values({ name: "P" }).returning();
  const [user] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
  const roles = ["owner"] as const;
  return { userId: user!.id, organizationId: org!.id, roles: [...roles], permissions: permissionsForRoles([...roles]) };
}

let sha = 0;
async function seedImport(
  principal: Principal,
  status: PayrollImportStatus,
  retentionUntil: Date,
): Promise<PayrollImport> {
  sha += 1;
  const key = String(sha).padStart(32, "0");
  const resolution = await resolveDocumentStore(principal.userId);
  await resolution!.store.put(`payroll/${principal.userId}/2026/${key}.pdf`, new TextEncoder().encode(`%PDF-${sha}`), "application/pdf");

  const db = await testDb();
  return withUserContext(db, { userId: principal.userId }, async (tx) => {
    const deps = payrollDeps(tx, { documents: resolution!.store, scanner: noopScanner });
    const created = await deps.imports.create({
      userId: principal.userId,
      fileName: "a.pdf",
      mime: "application/pdf",
      sizeBytes: 10,
      sha256: String(sha).padStart(64, "0"),
      storageProvider: "local",
      storageKey: `payroll/${principal.userId}/2026/${key}.pdf`,
      idempotencyKey: null,
      replacesImportId: null,
      retentionUntil,
      uploadedVia: "ui",
    });
    return (await deps.imports.patch(principal.userId, created.id, { status }))!;
  });
}

describe("purgeExpiredOriginals", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("deletes the object and keeps the row, stamping purgedAt (Ruling R4-5)", async () => {
    const principal = await seedPrincipal();
    const imp = await seedImport(principal, "applied", PAST);
    const resolution = await resolveDocumentStore(principal.userId);
    expect(await resolution!.store.get(imp.storageKey!)).not.toBeNull();

    expect(await purgeExpiredOriginals(NOW)).toEqual({ considered: 1, purged: 1, failed: 0 });

    expect(await resolution!.store.get(imp.storageKey!)).toBeNull();
    const db = await testDb();
    const after = await withUserContext(db, { userId: principal.userId }, (tx) =>
      payrollDeps(tx, { documents: resolution!.store, scanner: noopScanner }).imports.get(principal.userId, imp.id),
    );
    expect(after).not.toBeNull();
    expect(after?.storageKey).toBeNull();
    expect(after?.purgedAt).toEqual(NOW);
    expect(after?.status).toBe("applied");
  });

  it("never touches an import in a live status, however old its retention", async () => {
    const principal = await seedPrincipal();
    const seeded: PayrollImport[] = [];
    for (const status of LIVE_STATUSES) {
      seeded.push(await seedImport(principal, status, PAST));
    }

    expect(await purgeExpiredOriginals(NOW)).toEqual({ considered: 0, purged: 0, failed: 0 });

    const resolution = await resolveDocumentStore(principal.userId);
    for (const imp of seeded) {
      expect(await resolution!.store.get(imp.storageKey!)).not.toBeNull();
    }
  });

  it("leaves a retention window that has not run out alone", async () => {
    const principal = await seedPrincipal();
    await seedImport(principal, "applied", FUTURE);
    expect(await purgeExpiredOriginals(NOW)).toEqual({ considered: 0, purged: 0, failed: 0 });
  });

  it("is idempotent: a second run finds nothing left to do", async () => {
    const principal = await seedPrincipal();
    await seedImport(principal, "rejected", PAST);
    await purgeExpiredOriginals(NOW);
    expect(await purgeExpiredOriginals(NOW)).toEqual({ considered: 0, purged: 0, failed: 0 });
  });

  it("is capped, so a misconfigured window cannot wipe the archive in one tick", async () => {
    const principal = await seedPrincipal();
    const seeded: PayrollImport[] = [];
    for (let i = 0; i < 5; i += 1) seeded.push(await seedImport(principal, "superseded", PAST));

    expect(await purgeExpiredOriginals(NOW, 2)).toEqual({ considered: 2, purged: 2, failed: 0 });
    expect(PURGE_BATCH).toBe(100);

    const resolution = await resolveDocumentStore(principal.userId);
    const remaining = await Promise.all(seeded.map((imp) => resolution!.store.get(imp.storageKey!)));
    expect(remaining.filter((b) => b !== null)).toHaveLength(3);
  });

  it("counts a failed delete and does not abandon the rest of the batch (per-item isolation)", async () => {
    const principal = await seedPrincipal();
    const doomed = await seedImport(principal, "applied", PAST);
    const ok = await seedImport(principal, "rejected", PAST);
    const resolution = await resolveDocumentStore(principal.userId);
    const failingStore: DocumentStore = {
      ...resolution!.store,
      delete: async (key) => {
        if (key === doomed.storageKey) throw new Error("store unreachable");
        return resolution!.store.delete(key);
      },
    };

    const result = await purgeExpiredOriginals(NOW, PURGE_BATCH, { documents: failingStore });
    expect(result).toEqual({ considered: 2, purged: 1, failed: 1 });

    const db = await testDb();
    const doomedAfter = await withUserContext(db, { userId: principal.userId }, (tx) =>
      payrollDeps(tx, { documents: resolution!.store, scanner: noopScanner }).imports.get(principal.userId, doomed.id),
    );
    const okAfter = await withUserContext(db, { userId: principal.userId }, (tx) =>
      payrollDeps(tx, { documents: resolution!.store, scanner: noopScanner }).imports.get(principal.userId, ok.id),
    );
    // The failed delete's row keeps its key, so the next run retries it.
    expect(doomedAfter?.storageKey).toBe(doomed.storageKey);
    expect(doomedAfter?.purgedAt).toBeNull();
    // The other item in the same batch still purged successfully.
    expect(okAfter?.storageKey).toBeNull();
    expect(okAfter?.purgedAt).toEqual(NOW);
  });
});
