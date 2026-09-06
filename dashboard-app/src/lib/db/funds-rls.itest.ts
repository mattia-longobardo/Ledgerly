import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, resetDb, testDb } from "@/test/db";
import {
  funds, fundContributions, fundContributionSchedules, fundContributionTypes, fundPlans,
  reconciliationIssues, organizations, users, payrollImports, payrollRecords,
} from "@/lib/db/schema";
import { withSystemContext, withUserContext } from "@/platform/db/context";

async function fixture() {
  const db = await testDb();
  const [org] = await db.insert(organizations).values({ name: "P" }).returning();
  const [a, b] = await db.insert(users).values([
    { organizationId: org!.id, displayName: "A" },
    { organizationId: org!.id, displayName: "B" },
  ]).returning();
  const [fund] = await withUserContext(db, { userId: a!.id }, (tx) =>
    tx.insert(funds).values({ userId: a!.id, slug: "pension", name: "Pension", kind: "pension" }).returning());
  return { db, a: a!, b: b!, fund: fund! };
}

const contribution = (fundId: string) => ({
  fundId, typeCode: "employee", accrualPeriodStart: "2026-01-01",
  accrualPeriodEnd: "2026-03-01", postedMonth: "2026-04-01", amount: "100.00", source: "manual",
});

async function rejectsWith(query: PromiseLike<unknown>, message: string) {
  await expect(query).rejects.toMatchObject({ cause: { message: expect.stringContaining(message) } });
}

describe("funds RLS and uniqueness", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("a user sees only their funds; system sees all; no context sees none", async () => {
    const { db, a, b, fund } = await fixture();
    await withUserContext(db, { userId: b.id }, (tx) => tx.insert(funds).values({
      userId: b.id, slug: "pension", name: "B pension", kind: "pension",
    }));
    expect(await withUserContext(db, { userId: a.id }, (tx) => tx.select().from(funds))).toEqual([fund]);
    expect(await withSystemContext(db, (tx) => tx.select().from(funds))).toHaveLength(2);
    expect(await db.select().from(funds)).toEqual([]);
    await rejectsWith(withUserContext(db, { userId: b.id }, (tx) => tx.insert(funds).values({
      userId: a.id, slug: "foreign", name: "Foreign", kind: "other",
    })), "row-level security");
  });

  it("isolates contributions through their parent and rejects another owner's inserts", async () => {
    const { db, a, b, fund } = await fixture();
    const [row] = await withUserContext(db, { userId: a.id }, (tx) =>
      tx.insert(fundContributions).values(contribution(fund.id)).returning());
    expect(await withUserContext(db, { userId: a.id }, (tx) => tx.select().from(fundContributions))).toEqual([row]);
    expect(await withUserContext(db, { userId: b.id }, (tx) => tx.select().from(fundContributions))).toEqual([]);
    expect(await db.select().from(fundContributions)).toEqual([]);
    expect(await withSystemContext(db, (tx) => tx.select().from(fundContributions))).toHaveLength(1);
    await rejectsWith(withUserContext(db, { userId: b.id }, (tx) =>
      tx.insert(fundContributions).values(contribution(fund.id))), "row-level security");
  });

  it("isolates schedules and plans through their parent and rejects foreign writes", async () => {
    const { db, a, b, fund } = await fixture();
    const schedule = { fundId: fund.id, frequency: "quarterly", effectiveFrom: "2026-01-01" };
    const plan = { fundId: fund.id, effectiveFrom: "2026-01-01", initialCapital: "500.00" };
    await withUserContext(db, { userId: a.id }, async (tx) => {
      await tx.insert(fundContributionSchedules).values(schedule);
      await tx.insert(fundPlans).values(plan);
    });
    for (const table of [fundContributionSchedules, fundPlans]) {
      expect(await withUserContext(db, { userId: a.id }, (tx) => tx.select().from(table))).toHaveLength(1);
      expect(await withUserContext(db, { userId: b.id }, (tx) => tx.select().from(table))).toEqual([]);
      expect(await db.select().from(table)).toEqual([]);
      expect(await withSystemContext(db, (tx) => tx.select().from(table))).toHaveLength(1);
    }
    await rejectsWith(withUserContext(db, { userId: b.id }, (tx) =>
      tx.insert(fundContributionSchedules).values({ ...schedule, effectiveFrom: "2026-02-01" })), "row-level security");
    await rejectsWith(withUserContext(db, { userId: b.id }, (tx) =>
      tx.insert(fundPlans).values({ ...plan, effectiveFrom: "2026-02-01" })), "row-level security");
  });

  it("rejects duplicate payroll contributions but allows different component types", async () => {
    const { db, a, fund } = await fixture();
    const record = await withUserContext(db, { userId: a.id }, async (tx) => {
      const [imp] = await tx.insert(payrollImports).values({
        userId: a.id, fileName: "payslip.pdf", sizeBytes: 10, sha256: "a".repeat(64),
        retentionUntil: new Date("2027-01-01"),
      }).returning();
      const [row] = await tx.insert(payrollRecords).values({
        userId: a.id, importId: imp!.id, periodStart: "2026-01-01", periodEnd: "2026-01-31",
      }).returning();
      return row!;
    });
    const input = { ...contribution(fund.id), source: "payroll", payrollRecordId: record.id };
    await withUserContext(db, { userId: a.id }, (tx) => tx.insert(fundContributions).values(input));
    await rejectsWith(withUserContext(db, { userId: a.id }, (tx) =>
      tx.insert(fundContributions).values(input)), "fund_contributions_payroll_uq");
    await withUserContext(db, { userId: a.id }, (tx) =>
      tx.insert(fundContributions).values({ ...input, typeCode: "employer" }));
    expect(await withUserContext(db, { userId: a.id }, (tx) => tx.select().from(fundContributions))).toHaveLength(2);
  });

  it("allows only one system fee per posting month while permitting manual fees", async () => {
    const { db, a, fund } = await fixture();
    const input = { ...contribution(fund.id), typeCode: "fee", source: "system", amount: "-3.00" };
    await withUserContext(db, { userId: a.id }, (tx) => tx.insert(fundContributions).values(input));
    await rejectsWith(withUserContext(db, { userId: a.id }, (tx) =>
      tx.insert(fundContributions).values(input)), "fund_contributions_system_fee_uq");
    await withUserContext(db, { userId: a.id }, (tx) => tx.insert(fundContributions).values([
      { ...input, source: "manual" }, { ...input, postedMonth: "2026-07-01" },
    ]));
    expect(await withUserContext(db, { userId: a.id }, (tx) => tx.select().from(fundContributions))).toHaveLength(3);
  });

  it("isolates issues and allows a repeated issue key only after resolution", async () => {
    const { db, a, b, fund } = await fixture();
    const input = { userId: a.id, domain: "funds", entityType: "fund_month", entityId: `${fund.id}:2026-01-01`, kind: "missing" };
    const [issue] = await withUserContext(db, { userId: a.id }, (tx) => tx.insert(reconciliationIssues).values(input).returning());
    expect(await withUserContext(db, { userId: a.id }, (tx) => tx.select().from(reconciliationIssues))).toEqual([issue]);
    expect(await withUserContext(db, { userId: b.id }, (tx) => tx.select().from(reconciliationIssues))).toEqual([]);
    expect(await db.select().from(reconciliationIssues)).toEqual([]);
    expect(await withSystemContext(db, (tx) => tx.select().from(reconciliationIssues))).toHaveLength(1);
    await rejectsWith(withUserContext(db, { userId: b.id }, (tx) =>
      tx.insert(reconciliationIssues).values({ ...input, kind: "duplicate" })), "row-level security");
    await rejectsWith(withUserContext(db, { userId: a.id }, (tx) =>
      tx.insert(reconciliationIssues).values(input)), "reconciliation_issues_live_uq");
    await withUserContext(db, { userId: a.id }, (tx) => tx.update(reconciliationIssues)
      .set({ status: "acknowledged" }).where(eq(reconciliationIssues.id, issue!.id)));
    await rejectsWith(withUserContext(db, { userId: a.id }, (tx) =>
      tx.insert(reconciliationIssues).values(input)), "reconciliation_issues_live_uq");
    await withUserContext(db, { userId: a.id }, (tx) => tx.update(reconciliationIssues)
      .set({ status: "resolved", resolvedBy: a.id, resolvedAt: new Date() }).where(eq(reconciliationIssues.id, issue!.id)));
    await withUserContext(db, { userId: a.id }, (tx) => tx.insert(reconciliationIssues).values(input));
    expect(await withUserContext(db, { userId: a.id }, (tx) => tx.select().from(reconciliationIssues))).toHaveLength(2);
  });

  it("retains the contribution catalogue across database resets", async () => {
    const db = await testDb();
    await resetDb();
    expect(await db.select({ code: fundContributionTypes.code, sign: fundContributionTypes.sign })
      .from(fundContributionTypes).orderBy(fundContributionTypes.code)).toEqual([
      { code: "adjustment", sign: 0 }, { code: "employee", sign: 1 }, { code: "employer", sign: 1 },
      { code: "fee", sign: -1 }, { code: "reversal", sign: -1 }, { code: "voluntary", sign: 1 },
    ]);
  });
});
