import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb, testDb } from "@/test/db";
import { accounts, budgetAllocations, budgetUsages, budgets, organizations, transactions, users } from "@/lib/db/schema";
import { withSystemContext, withUserContext } from "@/platform/db/context";

async function fixture() {
  const db = await testDb();
  const [org] = await db.insert(organizations).values({ name: "P" }).returning();
  const [a, b] = await db.insert(users).values([
    { organizationId: org!.id, displayName: "A" },
    { organizationId: org!.id, displayName: "B" },
  ]).returning();
  const [budget] = await withUserContext(db, { userId: a!.id }, (tx) =>
    tx.insert(budgets).values({ userId: a!.id, name: "Groceries", startDate: "2026-01-01" }).returning());
  return { db, a: a!, b: b!, budget: budget! };
}

async function transactionFor(db: Awaited<ReturnType<typeof testDb>>, userId: string) {
  const [account] = await withSystemContext(db, (tx) =>
    tx.insert(accounts).values({ userId, name: "Cash", type: "cash", origin: "manual" }).returning());
  const [tx1] = await withSystemContext(db, (tx) =>
    tx.insert(transactions).values({
      userId, accountId: account!.id, occurredAt: new Date("2026-01-05"), amount: "-10.00", type: "expense",
    }).returning());
  return tx1!;
}

async function rejectsWith(query: PromiseLike<unknown>, message: string) {
  await expect(query).rejects.toMatchObject({ cause: { message: expect.stringContaining(message) } });
}

describe("budgets RLS and constraints", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("a user sees only their budgets; system sees all; no context sees none", async () => {
    const { db, a, b, budget } = await fixture();
    await withUserContext(db, { userId: b.id }, (tx) => tx.insert(budgets).values({
      userId: b.id, name: "B groceries", startDate: "2026-01-01",
    }));
    expect(await withUserContext(db, { userId: a.id }, (tx) => tx.select().from(budgets))).toEqual([budget]);
    expect(await withSystemContext(db, (tx) => tx.select().from(budgets))).toHaveLength(2);
    expect(await db.select().from(budgets)).toEqual([]);
    await rejectsWith(withUserContext(db, { userId: b.id }, (tx) => tx.insert(budgets).values({
      userId: a.id, name: "Foreign", startDate: "2026-01-01",
    })), "row-level security");
  });

  it("isolates allocations through their parent and rejects another owner's inserts", async () => {
    const { db, a, b, budget } = await fixture();
    const allocation = { budgetId: budget.id, amount: "50.00", effectiveFrom: "2026-01-01" };
    const [row] = await withUserContext(db, { userId: a.id }, (tx) =>
      tx.insert(budgetAllocations).values(allocation).returning());
    expect(await withUserContext(db, { userId: a.id }, (tx) => tx.select().from(budgetAllocations))).toEqual([row]);
    expect(await withUserContext(db, { userId: b.id }, (tx) => tx.select().from(budgetAllocations))).toEqual([]);
    expect(await db.select().from(budgetAllocations)).toEqual([]);
    expect(await withSystemContext(db, (tx) => tx.select().from(budgetAllocations))).toHaveLength(1);
    await rejectsWith(withUserContext(db, { userId: b.id }, (tx) =>
      tx.insert(budgetAllocations).values(allocation)), "row-level security");
  });

  it("rejects a second scope-matched usage for the same transaction", async () => {
    const { db, a, budget } = await fixture();
    const txRow = await transactionFor(db, a.id);
    const usage = {
      budgetId: budget.id, transactionId: txRow.id, amount: "10.00",
      occurredAt: "2026-01-05", matchedBy: "scope" as const,
    };
    await withUserContext(db, { userId: a.id }, (tx) => tx.insert(budgetUsages).values(usage));
    await rejectsWith(withUserContext(db, { userId: a.id }, (tx) =>
      tx.insert(budgetUsages).values(usage)), "budget_usages_tx_uq");
  });

  it("rejects an account-sourced allocation with no source id", async () => {
    const { db, a, budget } = await fixture();
    await rejectsWith(withUserContext(db, { userId: a.id }, (tx) =>
      tx.insert(budgetAllocations).values({
        budgetId: budget.id, sourceKind: "account", sourceId: null, amount: "50.00", effectiveFrom: "2026-01-01",
      })), "budget_allocations_source_id_ck");
  });

  it("rejects a manual usage that carries a transaction id", async () => {
    const { db, a, budget } = await fixture();
    const txRow = await transactionFor(db, a.id);
    await rejectsWith(withUserContext(db, { userId: a.id }, (tx) =>
      tx.insert(budgetUsages).values({
        budgetId: budget.id, transactionId: txRow.id, amount: "10.00",
        occurredAt: "2026-01-05", matchedBy: "manual",
      })), "budget_usages_tx_ck");
  });
});
