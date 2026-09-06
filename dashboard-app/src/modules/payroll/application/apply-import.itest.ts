import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { PayslipExtraction } from "@/lib/contracts";
import {
  auditEvents,
  fundContributionSchedules,
  fundContributions,
  funds,
  organizations,
  payrollRecords,
  users,
} from "@/lib/db/schema";
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
  await withUserContext(db, { userId: user!.id }, async (tx) => {
    const [fund] = await tx.insert(funds).values({
      userId: user!.id,
      slug: "cometa",
      name: "Fondo Cometa",
      kind: "pension",
      currency: "EUR",
    }).returning();
    await tx.insert(fundContributionSchedules).values({
      fundId: fund!.id,
      frequency: "quarterly",
      periodAnchorMonth: 1,
      postingLagMonths: 1,
      feePerPosting: "3.00",
      effectiveFrom: "2026-01-01",
    });
  });
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
async function aVerifiedImport(
  db: Awaited<ReturnType<typeof testDb>>,
  principal: Principal,
  selectedExtraction: PayslipExtraction = extraction,
) {
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
      extraction: selectedExtraction,
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

  it("writes payroll contributions and one posting fee for the mapped fund", async () => {
    const { db, principal } = await seed();
    const imp = await aVerifiedImport(db, principal);
    const applied = await withUserContext(db, { userId: principal.userId }, (tx) =>
      applyImport(payrollDeps(tx, { documents: NOOP_STORE, scanner: noopScanner }))(principal, imp.id),
    );
    expect(applied.fundContributions).toEqual({ written: 2, skipped: [] });
    const rows = await withUserContext(db, { userId: principal.userId }, (tx) => tx.select().from(fundContributions));
    expect(rows).toEqual([
      expect.objectContaining({
        typeCode: "employee",
        amount: "50.00",
        accrualPeriodStart: "2026-07-01",
        accrualPeriodEnd: "2026-09-01",
        postedMonth: "2026-10-01",
        source: "payroll",
        payrollRecordId: applied.record.id,
      }),
      expect.objectContaining({
        typeCode: "employer",
        amount: "100.00",
        payrollRecordId: applied.record.id,
      }),
      expect.objectContaining({
        typeCode: "fee",
        amount: "-3.00",
        postedMonth: "2026-10-01",
        source: "system",
        payrollRecordId: null,
      }),
    ]);
  });

  it("re-applies the current record by removing its original/reversal pairs and orphan fee while retaining audit evidence", async () => {
    const { db, principal } = await seed();
    const imp = await aVerifiedImport(db, principal);
    const first = await withUserContext(db, { userId: principal.userId }, (tx) =>
      applyImport(payrollDeps(tx, { documents: NOOP_STORE, scanner: noopScanner }))(principal, imp.id),
    );
    await withUserContext(db, { userId: principal.userId }, async (tx) => {
      const [original] = await tx.select().from(fundContributions);
      const [reversal] = await tx.insert(fundContributions).values({
        fundId: original!.fundId,
        typeCode: "reversal",
        accrualPeriodStart: original!.accrualPeriodStart,
        accrualPeriodEnd: original!.accrualPeriodEnd,
        postedMonth: original!.postedMonth,
        amount: `-${original!.amount}`,
        currency: original!.currency,
        source: "manual",
        payrollRecordId: null,
        reversesId: original!.id,
        reconciliationStatus: "received",
      }).returning();
      await tx.insert(auditEvents).values({
        actorUserId: principal.userId,
        action: "funds.contribution_reversed",
        entityType: "fund_contribution",
        entityId: reversal!.id,
        before: original,
        after: reversal,
      });
      const deps = payrollDeps(tx, { documents: NOOP_STORE, scanner: noopScanner });
      await deps.imports.patch(principal.userId, imp.id, {
        status: "verified",
        extraction: {
          ...extraction,
          fields: { net: extraction.fields.net! },
        },
      });
    });

    const reapplied = await withUserContext(db, { userId: principal.userId }, (tx) =>
      applyImport(payrollDeps(tx, { documents: NOOP_STORE, scanner: noopScanner }))(principal, imp.id),
    );
    expect(reapplied.record.id).toBe(first.record.id);
    expect(reapplied.fundContributions).toEqual({ written: 0, skipped: [] });
    await withUserContext(db, { userId: principal.userId }, async (tx) => {
      expect(await tx.select().from(fundContributions)).toEqual([]);
      expect((await tx.select().from(auditEvents)).some((row) => row.action === "funds.contribution_reversed")).toBe(true);
    });
  });

  it("supersession removes the old fund posting when the replacement removes the mapping", async () => {
    const { db, principal } = await seed();
    const original = await aVerifiedImport(db, principal);
    const first = await withUserContext(db, { userId: principal.userId }, (tx) =>
      applyImport(payrollDeps(tx, { documents: NOOP_STORE, scanner: noopScanner }))(principal, original.id),
    );
    const replacement = await aVerifiedImport(db, principal, {
      ...extraction,
      fields: { net: extraction.fields.net! },
    });
    const second = await withUserContext(db, { userId: principal.userId }, (tx) =>
      applyImport(payrollDeps(tx, { documents: NOOP_STORE, scanner: noopScanner }))(principal, replacement.id),
    );
    expect(second.supersededRecordId).toBe(first.record.id);
    await withUserContext(db, { userId: principal.userId }, async (tx) => {
      expect(await tx.select().from(fundContributions)).toEqual([]);
    });
  });

  it("rolls back apply when a mapped contribution currency differs from the owner fund", async () => {
    const { db, principal } = await seed();
    await withUserContext(db, { userId: principal.userId }, (tx) => tx.update(funds).set({ currency: "USD" }));
    const imp = await aVerifiedImport(db, principal);
    await expect(withUserContext(db, { userId: principal.userId }, (tx) =>
      applyImport(payrollDeps(tx, { documents: NOOP_STORE, scanner: noopScanner }))(principal, imp.id),
    )).rejects.toThrow(/currency/i);
    await withUserContext(db, { userId: principal.userId }, async (tx) => {
      expect(await tx.select().from(payrollRecords)).toEqual([]);
      expect(await tx.select().from(fundContributions)).toEqual([]);
    });
  });

  it("cannot resolve another owner's fund slug", async () => {
    const { db, principal: owner } = await seed();
    const [other] = await db.insert(users).values({
      organizationId: owner.organizationId,
      displayName: "Other",
    }).returning();
    const principal: Principal = { ...owner, userId: other!.id };
    const imp = await aVerifiedImport(db, principal);
    const applied = await withUserContext(db, { userId: principal.userId }, (tx) =>
      applyImport(payrollDeps(tx, { documents: NOOP_STORE, scanner: noopScanner }))(principal, imp.id),
    );
    expect(applied.fundContributions).toEqual({
      written: 0,
      skipped: [
        { fundSlug: "cometa", reason: "no_fund" },
        { fundSlug: "cometa", reason: "no_fund" },
      ],
    });
    await withUserContext(db, { userId: owner.userId }, async (tx) => {
      expect(await tx.select().from(fundContributions)).toEqual([]);
    });
  });
});
