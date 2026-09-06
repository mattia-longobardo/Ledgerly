import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { closeDb, resetDb, testDb } from "@/test/db";
import {
  budgetAllocations,
  budgetAmountVersions,
  budgetEvents,
  budgetUsages,
  budgets,
  organizations,
  roles,
  userRoles,
  users,
  vacationAccrualRate,
  vacationLedger,
} from "@/lib/db/schema";
import { withSystemContext } from "@/platform/db/context";
import { figures } from "@/modules/budgets/domain/figures";
// Relative, not "@/...": these live in scripts/, outside src/, and are not
// part of the app bundle — only exported for this test.
import { migrate } from "../../../scripts/migrate-vacation-budget";
import { validate } from "../../../scripts/validate-vacation-budget-migration";

const ASOF = "2026-09-06";
const ASOF_NEXT_MONTH = "2026-10-06";

async function ownerFixture() {
  const db = await testDb();
  await db.insert(roles).values({ code: "owner", label: "Owner" }).onConflictDoNothing();
  const [org] = await db.insert(organizations).values({ name: "P" }).returning();
  const [owner] = await db
    .insert(users)
    .values({ organizationId: org!.id, displayName: "Owner", currency: "EUR" })
    .returning();
  await db.insert(userRoles).values({ userId: owner!.id, roleCode: "owner" });
  return { db, owner: owner! };
}

/**
 * Brief's fixture, redated so the withdrawal and adjustment fall within the
 * R6-4 reconciliation horizon (the last legacy `accrual` month, March 2026)
 * rather than after it — see Critical 1 in the round-1 review: past that
 * horizon the migrated budget is expected to diverge from the frozen
 * ledger, so a balance check there would be meaningless, and this suite
 * wants every inserted row exercised by the month-by-month check.
 */
async function legacyFixture(db: Awaited<ReturnType<typeof testDb>>) {
  await withSystemContext(db, async (tx) => {
    await tx.insert(vacationAccrualRate).values([
      { effectiveFrom: "2026-01-01", monthlyAmount: "50.00" },
      { effectiveFrom: "2026-04-01", monthlyAmount: "60.00" },
    ]);
    await tx.insert(vacationLedger).values([
      { entryType: "initial", month: null, amount: "500.00", note: null, occurredAt: new Date("2026-01-01T00:00:00Z") },
      { entryType: "accrual", month: "2026-01-01", amount: "50.00", note: null, occurredAt: new Date("2026-01-31T00:00:00Z") },
      { entryType: "accrual", month: "2026-02-01", amount: "45.00", note: null, occurredAt: new Date("2026-02-28T00:00:00Z") },
      { entryType: "accrual", month: "2026-03-01", amount: "50.00", note: null, occurredAt: new Date("2026-03-31T00:00:00Z") },
      { entryType: "withdrawal", month: null, amount: "-30.00", note: "Trip to Rome", occurredAt: new Date("2026-02-10T00:00:00Z") },
      { entryType: "adjustment", month: null, amount: "-20.00", note: "Manual correction", occurredAt: new Date("2026-03-05T00:00:00Z") },
    ]);
  });
}

/**
 * The production shape round 2's review flagged as untested: a withdrawal
 * and an adjustment dated *after* the last accrual month (March 2026) —
 * exactly like the manual SQL fixture, but exercised here as an automated
 * regression for the structural checks and the extended balance loop.
 */
async function postHorizonFixture(db: Awaited<ReturnType<typeof testDb>>) {
  await withSystemContext(db, async (tx) => {
    await tx.insert(vacationAccrualRate).values([
      { effectiveFrom: "2026-01-01", monthlyAmount: "50.00" },
      { effectiveFrom: "2026-04-01", monthlyAmount: "60.00" },
    ]);
    await tx.insert(vacationLedger).values([
      { entryType: "initial", month: null, amount: "500.00", note: null, occurredAt: new Date("2026-01-01T00:00:00Z") },
      { entryType: "accrual", month: "2026-01-01", amount: "50.00", note: null, occurredAt: new Date("2026-01-31T00:00:00Z") },
      { entryType: "accrual", month: "2026-02-01", amount: "45.00", note: null, occurredAt: new Date("2026-02-28T00:00:00Z") },
      { entryType: "accrual", month: "2026-03-01", amount: "50.00", note: null, occurredAt: new Date("2026-03-31T00:00:00Z") },
      { entryType: "withdrawal", month: null, amount: "-40.00", note: "Trip to Rome", occurredAt: new Date("2026-05-10T00:00:00Z") },
      { entryType: "adjustment", month: null, amount: "25.00", note: "Manual correction", occurredAt: new Date("2026-06-15T00:00:00Z") },
    ]);
  });
}

async function counts(db: Awaited<ReturnType<typeof testDb>>) {
  return withSystemContext(db, async (tx) => ({
    budgets: (await tx.select().from(budgets)).length,
    versions: (await tx.select().from(budgetAmountVersions)).length,
    allocations: (await tx.select().from(budgetAllocations)).length,
    usages: (await tx.select().from(budgetUsages)).length,
    events: (await tx.select().from(budgetEvents)).length,
  }));
}

describe("vacation → Holidays budget migration", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("(a) both legacy tables empty: nothing to migrate, zero rows written", async () => {
    const { db } = await ownerFixture();
    const result = await withSystemContext(db, (tx) => migrate(tx, ASOF));
    expect(result).toBeNull();
    expect(await counts(db)).toEqual({ budgets: 0, versions: 0, allocations: 0, usages: 0, events: 0 });
  });

  it("(b) the brief's fixture migrates to the expected shape", async () => {
    const { db, owner } = await ownerFixture();
    await legacyFixture(db);

    await withSystemContext(db, (tx) => migrate(tx, ASOF));

    const [budget] = await withSystemContext(db, (tx) =>
      tx.select().from(budgets).where(eq(budgets.userId, owner.id)));
    expect(budget).toMatchObject({
      name: "Holidays",
      periodKind: "none",
      startDate: "2026-01-01",
      labels: ["migrated"],
      description: "Migrated from the Vacation fund",
    });

    const versions = await withSystemContext(db, (tx) =>
      tx.select().from(budgetAmountVersions).where(eq(budgetAmountVersions.budgetId, budget!.id)));
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ initialAmount: "500.00", effectiveFrom: "2026-01-01" });

    const allocations = await withSystemContext(db, (tx) =>
      tx.select().from(budgetAllocations).where(eq(budgetAllocations.budgetId, budget!.id)).orderBy(asc(budgetAllocations.effectiveFrom)));
    const monthlyAllocations = allocations.filter((a) => a.recurrence === "monthly");
    expect(monthlyAllocations).toHaveLength(2);
    expect(monthlyAllocations[0]).toMatchObject({
      amount: "50.00",
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-03-31",
      sourceKind: "none",
      sourceId: null,
    });
    expect(monthlyAllocations[1]).toMatchObject({
      amount: "60.00",
      effectiveFrom: "2026-04-01",
      effectiveTo: null,
      sourceKind: "none",
      sourceId: null,
    });

    const usages = await withSystemContext(db, (tx) =>
      tx.select().from(budgetUsages).where(eq(budgetUsages.budgetId, budget!.id)));
    expect(usages).toHaveLength(1);
    expect(usages[0]).toMatchObject({
      amount: "30.00",
      occurredAt: "2026-02-10",
      matchedBy: "manual",
      transactionId: null,
    });
  });

  it("(c) a second migrate() writes nothing and leaves row counts unchanged", async () => {
    const { db } = await ownerFixture();
    await legacyFixture(db);

    await withSystemContext(db, (tx) => migrate(tx, ASOF));
    const before = await counts(db);

    const second = await withSystemContext(db, (tx) => migrate(tx, ASOF));
    expect(second).toEqual({
      budgets: 0, versions: 0, rateAllocations: 0, withdrawalUsages: 0, adjustmentAllocations: 0, reconciliationAllocations: 0,
    });
    expect(await counts(db)).toEqual(before);
  });

  it("(d) re-running after a migrated note is edited writes nothing [Critical 2]", async () => {
    const { db } = await ownerFixture();
    await legacyFixture(db);
    await withSystemContext(db, (tx) => migrate(tx, ASOF));
    const before = await counts(db);

    // A user edits a migrated allocation's note — a supported product operation
    // (AllocationsRepository.update patches effectiveTo|note). Idempotency must
    // not depend on this field surviving unedited.
    await withSystemContext(db, (tx) =>
      tx.update(budgetAllocations).set({ note: "renamed by a user" }).where(eq(budgetAllocations.recurrence, "monthly")));

    const second = await withSystemContext(db, (tx) => migrate(tx, ASOF));
    expect(second).toEqual({
      budgets: 0, versions: 0, rateAllocations: 0, withdrawalUsages: 0, adjustmentAllocations: 0, reconciliationAllocations: 0,
    });
    const after = await counts(db);
    expect(after.allocations).toBe(before.allocations);
    expect(after.usages).toBe(before.usages);
  });

  it("(e) re-running a month later writes nothing [Critical 1]", async () => {
    const { db } = await ownerFixture();
    await legacyFixture(db);
    await withSystemContext(db, (tx) => migrate(tx, ASOF));
    const before = await counts(db);

    const second = await withSystemContext(db, (tx) => migrate(tx, ASOF_NEXT_MONTH));
    expect(second).toEqual({
      budgets: 0, versions: 0, rateAllocations: 0, withdrawalUsages: 0, adjustmentAllocations: 0, reconciliationAllocations: 0,
    });
    expect(await counts(db)).toEqual(before);
  });

  it("(f) a negative adjustment row becomes a once allocation carrying the negative amount", async () => {
    const { db, owner } = await ownerFixture();
    await legacyFixture(db);
    await withSystemContext(db, (tx) => migrate(tx, ASOF));

    const [budget] = await withSystemContext(db, (tx) => tx.select().from(budgets).where(eq(budgets.userId, owner.id)));
    const allocations = await withSystemContext(db, (tx) =>
      tx.select().from(budgetAllocations).where(eq(budgetAllocations.budgetId, budget!.id)));
    const adjustment = allocations.find((a) => a.recurrence === "once" && a.effectiveFrom === "2026-03-05");
    expect(adjustment).toMatchObject({ amount: "-20.00", sourceKind: "none", sourceId: null });
  });

  it("(g) figures().remaining matches hand-computed constants at a frozen asOf, month by month", async () => {
    const { db, owner } = await ownerFixture();
    await legacyFixture(db);
    await withSystemContext(db, (tx) => migrate(tx, ASOF));

    const [budget] = await withSystemContext(db, (tx) => tx.select().from(budgets).where(eq(budgets.userId, owner.id)));
    const versions = await withSystemContext(db, (tx) => tx.select().from(budgetAmountVersions).where(eq(budgetAmountVersions.budgetId, budget!.id)));
    const allocations = await withSystemContext(db, (tx) => tx.select().from(budgetAllocations).where(eq(budgetAllocations.budgetId, budget!.id)));
    const usages = await withSystemContext(db, (tx) => tx.select().from(budgetUsages).where(eq(budgetUsages.budgetId, budget!.id)));

    const input = {
      versions: versions.map((v) => ({ initialAmount: v.initialAmount, effectiveFrom: v.effectiveFrom })),
      allocations: allocations.map((a) => ({
        id: a.id, amount: a.amount, recurrence: a.recurrence as "once" | "monthly",
        effectiveFrom: a.effectiveFrom, effectiveTo: a.effectiveTo,
        sourceKind: a.sourceKind as "none" | "fund" | "account", sourceId: a.sourceId,
      })),
      usages: usages.map((u) => ({ amount: u.amount, occurredAt: u.occurredAt })),
      goalAmount: null,
    };

    // Hand-computed: initial 500 + accruals(≤month) − |withdrawal Feb 10, 30| + adjustment(Mar 5, −20).
    expect(figures(input, "2026-01-31").remaining).toBe("550.00");
    expect(figures(input, "2026-02-28").remaining).toBe("565.00");
    expect(figures(input, "2026-03-31").remaining).toBe("595.00");
  });

  it("validate() agrees with the migration on the brief's fixture", async () => {
    const { db } = await ownerFixture();
    await legacyFixture(db);
    await withSystemContext(db, (tx) => migrate(tx, ASOF));
    const result = await withSystemContext(db, (tx) => validate(tx, ASOF));
    expect(result.examined).toBeGreaterThan(0);
  });

  it("(h) notes are restored to their plain, descriptive values — a regression to id-bearing notes must fail this", async () => {
    const { db, owner } = await ownerFixture();
    await legacyFixture(db);
    await withSystemContext(db, (tx) => migrate(tx, ASOF));

    const [budget] = await withSystemContext(db, (tx) => tx.select().from(budgets).where(eq(budgets.userId, owner.id)));
    const allocations = await withSystemContext(db, (tx) =>
      tx.select().from(budgetAllocations).where(eq(budgetAllocations.budgetId, budget!.id)));
    const usages = await withSystemContext(db, (tx) =>
      tx.select().from(budgetUsages).where(eq(budgetUsages.budgetId, budget!.id)));

    const rateNotes = allocations.filter((a) => a.recurrence === "monthly").map((a) => a.note);
    expect(rateNotes).toEqual(["migrated accrual rate", "migrated accrual rate"]);

    const adjustmentNote = allocations.find((a) => a.recurrence === "once" && a.effectiveFrom === "2026-03-05")?.note;
    expect(adjustmentNote).toBe("migrated adjustment");

    // The legacy row's own note, carried through unchanged — no id suffix.
    expect(usages[0]!.note).toBe("Trip to Rome");
  });

  it("(i) a withdrawal and adjustment dated after the last accrual month are validated exactly [round 2 Important 1]", async () => {
    const { db, owner } = await ownerFixture();
    await postHorizonFixture(db);
    await withSystemContext(db, (tx) => migrate(tx, ASOF));

    const result = await withSystemContext(db, (tx) => validate(tx, ASOF));
    expect(result.examined).toBe(6); // Jan..Jun: the adjustment (Jun 15) is the last legacy row.

    const [budget] = await withSystemContext(db, (tx) => tx.select().from(budgets).where(eq(budgets.userId, owner.id)));
    const versions = await withSystemContext(db, (tx) => tx.select().from(budgetAmountVersions).where(eq(budgetAmountVersions.budgetId, budget!.id)));
    const allocations = await withSystemContext(db, (tx) => tx.select().from(budgetAllocations).where(eq(budgetAllocations.budgetId, budget!.id)));
    const usages = await withSystemContext(db, (tx) => tx.select().from(budgetUsages).where(eq(budgetUsages.budgetId, budget!.id)));
    const input = {
      versions: versions.map((v) => ({ initialAmount: v.initialAmount, effectiveFrom: v.effectiveFrom })),
      allocations: allocations.map((a) => ({
        id: a.id, amount: a.amount, recurrence: a.recurrence as "once" | "monthly",
        effectiveFrom: a.effectiveFrom, effectiveTo: a.effectiveTo,
        sourceKind: a.sourceKind as "none" | "fund" | "account", sourceId: a.sourceId,
      })),
      usages: usages.map((u) => ({ amount: u.amount, occurredAt: u.occurredAt })),
      goalAmount: null,
    };
    // Hand-computed via the round-2 identity for M > M_a (M_a = March):
    // expected(M) = legacyBalance(M) + [rateTotal(lastDay(M)) − rateTotal(lastDay(M_a))].
    // May:  legacyBalance = 500 + 145 (accrual, frozen) + 0 (no adjustment yet) − 40 (withdrawal) = 605;
    //       rateTotal(May) = 150 (rate1, capped) + 120 (rate2, 2 months) = 270; rateTotal(Mar) = 150; delta = 120 -> 725.
    // June: legacyBalance = 500 + 145 + 25 (adjustment) − 40 = 630;
    //       rateTotal(Jun) = 150 + 180 (rate2, 3 months) = 330; delta = 180 -> 810.
    expect(figures(input, "2026-05-31").remaining).toBe("725.00");
    expect(figures(input, "2026-06-30").remaining).toBe("810.00");
  });

  it("(j) validate() catches a withdrawal migrated with the wrong sign after the last accrual month [round 2 Important 1]", async () => {
    const { db, owner } = await ownerFixture();
    await postHorizonFixture(db);
    await withSystemContext(db, (tx) => migrate(tx, ASOF));

    // Simulate exactly the bug round 1's validator could not see: a withdrawal
    // written signed instead of |amount|. This is dated after the last accrual
    // month (May, after March), so round 1's horizon-bound balance loop would
    // never have examined it.
    await withSystemContext(db, (tx) =>
      tx.update(budgetUsages).set({ amount: "-40.00" }).where(eq(budgetUsages.occurredAt, "2026-05-10")));

    await expect(withSystemContext(db, (tx) => validate(tx, ASOF))).rejects.toThrow(/manual usage/i);
  });

  it("(k) validate() catches a misdated adjustment after the last accrual month [round 2 Important 1]", async () => {
    const { db, owner } = await ownerFixture();
    await postHorizonFixture(db);
    await withSystemContext(db, (tx) => migrate(tx, ASOF));

    await withSystemContext(db, (tx) =>
      tx.update(budgetAllocations).set({ effectiveFrom: "2026-07-01" }).where(eq(budgetAllocations.amount, "25.00")));

    await expect(withSystemContext(db, (tx) => validate(tx, ASOF))).rejects.toThrow(/once allocation/i);
  });

  it("(l) a renamed/relabelled budget is still found via budget_events, and a second run still writes nothing [round 2 Important 2]", async () => {
    const { db, owner } = await ownerFixture();
    await legacyFixture(db);
    await withSystemContext(db, (tx) => migrate(tx, ASOF));
    const before = await counts(db);

    // A user renames the budget and drops the "migrated" label — both
    // BudgetPatch-supported operations. name+labels can no longer find it.
    await withSystemContext(db, (tx) =>
      tx.update(budgets).set({ name: "My holidays", labels: [] }).where(eq(budgets.userId, owner.id)));

    const second = await withSystemContext(db, (tx) => migrate(tx, ASOF));
    expect(second).toEqual({
      budgets: 0, versions: 0, rateAllocations: 0, withdrawalUsages: 0, adjustmentAllocations: 0, reconciliationAllocations: 0,
    });
    expect(await counts(db)).toEqual(before);

    const result = await withSystemContext(db, (tx) => validate(tx, ASOF));
    expect(result.examined).toBeGreaterThan(0);
  });

  it("(m) a name+labels match with no migration events aborts rather than re-migrating [round 2 Important 2]", async () => {
    const { db, owner } = await ownerFixture();
    await legacyFixture(db);

    // Simulate a database migrated by the original (pre-budget_events) script:
    // a budget with the migrated name/labels but zero budget_events rows.
    await withSystemContext(db, (tx) =>
      tx.insert(budgets).values({
        userId: owner.id, name: "Holidays", labels: ["migrated"], periodKind: "none", startDate: "2026-01-01",
      }));

    await expect(withSystemContext(db, (tx) => migrate(tx, ASOF))).rejects.toThrow(/no migration/i);
    await expect(withSystemContext(db, (tx) => validate(tx, ASOF))).rejects.toThrow(/no migration/i);
  });
});
