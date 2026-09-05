import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { PayslipExtraction } from "@/lib/contracts";
import { funds, organizations, payrollRecords, users } from "@/lib/db/schema";
import { permissionsForRoles } from "@/platform/auth/permissions";
import type { Principal } from "@/platform/auth/principal";
import { withUserContext } from "@/platform/db/context";
import { closeDb, resetDb, testDb } from "@/test/db";
import { noopScanner } from "../infrastructure/noop-scanner";
import { payrollDeps } from "../infrastructure/deps";
import { applyImport } from "./apply-import";

const NOOP_STORE = {
  provider: "local" as const,
  put: async () => {},
  get: async () => null,
  delete: async () => {},
  listPrefix: async () => [],
};

const extraction: PayslipExtraction = {
  parserVersion: "payroll-1.0.0",
  month: "2026-08-01",
  isThirteenth: false,
  textSource: "pdf",
  fields: {
    gross: { value: 2500, confidence: "high", rules: 2500, llm: null },
    net: { value: 1800, confidence: "high", rules: 1800, llm: null },
    fundContribEmployee: { value: 50, confidence: "high", rules: 50, llm: null },
    fundContribEmployer: { value: 100, confidence: "high", rules: 100, llm: null },
  },
  checks: [],
};

async function seed() {
  const db = await testDb();
  const [org] = await db.insert(organizations).values({ name: "P" }).returning();
  const [user] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
  await db.insert(funds).values({ id: 1, slug: "cometa", name: "Fondo Cometa" }).onConflictDoNothing();
  const roles = ["owner"] as const;
  const principal: Principal = {
    userId: user!.id,
    organizationId: org!.id,
    roles: [...roles],
    permissions: permissionsForRoles([...roles]),
  };
  return { db, principal };
}

let sha = 0;
async function aVerifiedImport(db: Awaited<ReturnType<typeof testDb>>, principal: Principal) {
  sha += 1;
  return withUserContext(db, { userId: principal.userId }, async (tx) => {
    const deps = payrollDeps(tx, { documents: NOOP_STORE, scanner: noopScanner });
    const created = await deps.imports.create({
      userId: principal.userId,
      fileName: "Busta Paga Agosto 2026.pdf",
      mime: "application/pdf",
      sizeBytes: 100,
      sha256: String(sha).padStart(64, "0"),
      storageProvider: "local",
      storageKey: `payroll/${principal.userId}/2026/${String(sha).padStart(32, "0")}.pdf`,
      idempotencyKey: null,
      replacesImportId: null,
      retentionUntil: new Date("2036-01-01T00:00:00Z"),
      uploadedVia: "ui",
    });
    return (await deps.imports.patch(principal.userId, created.id, {
      status: "verified",
      scanStatus: "clean",
      scanner: "none",
      extraction,
    }))!;
  });
}

describe("applyImport against real Postgres", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("supersedes and inserts in one transaction without tripping payroll_records_period_uq", async () => {
    const { db, principal } = await seed();
    const original = await aVerifiedImport(db, principal);
    const first = await withUserContext(db, { userId: principal.userId }, (tx) =>
      applyImport(payrollDeps(tx, { documents: NOOP_STORE, scanner: noopScanner }))(principal, original.id),
    );
    const replacement = await aVerifiedImport(db, principal);
    const second = await withUserContext(db, { userId: principal.userId }, (tx) =>
      applyImport(payrollDeps(tx, { documents: NOOP_STORE, scanner: noopScanner }))(principal, replacement.id),
    );

    expect(second.supersededRecordId).toBe(first.record.id);
    const rows = await withUserContext(db, { userId: principal.userId }, (tx) => tx.select().from(payrollRecords));
    expect(rows.length).toBe(2);
    expect(rows.filter((r) => r.supersededAt === null).map((r) => r.id)).toEqual([second.record.id]);
  });

  it("writes the legacy fund deposit for the month", async () => {
    const { db, principal } = await seed();
    const imp = await aVerifiedImport(db, principal);
    const applied = await withUserContext(db, { userId: principal.userId }, (tx) =>
      applyImport(payrollDeps(tx, { documents: NOOP_STORE, scanner: noopScanner }))(principal, imp.id),
    );
    expect(applied.fundDeposit).toBe("written");
  });
});
