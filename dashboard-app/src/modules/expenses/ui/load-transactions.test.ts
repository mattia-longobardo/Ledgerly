import { describe, expect, it } from "vitest";
import {
  MemoryCategoriesRepository,
  MemoryLabelsRepository,
  MemoryRecurringPatternsRepository,
  MemoryTransactionsRepository,
} from "../infrastructure/memory-repositories";
import { testPrincipal } from "@/test/principal";
import { setExpenseDepsFactoryForTests, setPrincipalForTests } from "./run";
import { loadRecurringPatterns, loadTransactionDetail, loadTransactionsPage } from "./load-transactions";

describe("loadTransactionsPage", () => {
  it("flattens dates to ISO strings and carries the category name", async () => {
    const deps = {
      transactions: new MemoryTransactionsRepository(),
      categories: new MemoryCategoriesRepository(),
      labels: new MemoryLabelsRepository(),
      recurring: new MemoryRecurringPatternsRepository(),
      clock: { now: () => new Date("2026-09-05T00:00:00Z") },
      audit: async () => {},
    };
    const category = await deps.categories.create({
      userId: "00000000-0000-7000-8000-000000000001",
      name: "Groceries",
      groupName: null,
      kind: "expense",
      color: null,
      parentId: null,
      source: "manual",
      archivedAt: null,
    });
    if (category === "duplicate_name") throw new Error("unexpected duplicate category name in test setup");
    await deps.transactions.create({
      userId: "00000000-0000-7000-8000-000000000001",
      accountId: "acc-1",
      occurredAt: new Date("2026-09-01T08:00:00Z"),
      bookedAt: null,
      amount: "-10.00",
      currency: "EUR",
      type: "expense",
      state: "cleared",
      categoryId: category.id,
      payee: "Shop",
      note: null,
      transferGroupId: null,
      source: "manual",
      syncRunId: null,
    });

    setExpenseDepsFactoryForTests(() => deps);
    setPrincipalForTests(testPrincipal());
    const page = await loadTransactionsPage({});
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]).toMatchObject({ amount: "-10.00", categoryName: "Groceries" });
    expect(typeof page.rows[0]!.occurredAt).toBe("string");
    setExpenseDepsFactoryForTests(null);
    setPrincipalForTests(null);
  });
});

describe("loadTransactionDetail", () => {
  it("rethrows a non-NotFoundError from the use case instead of returning null", async () => {
    const baseTransactions = new MemoryTransactionsRepository();
    const transactions = Object.create(baseTransactions) as MemoryTransactionsRepository;
    transactions.get = async () => {
      throw new Error("boom");
    };
    const deps = {
      transactions,
      categories: new MemoryCategoriesRepository(),
      labels: new MemoryLabelsRepository(),
      recurring: new MemoryRecurringPatternsRepository(),
      clock: { now: () => new Date("2026-09-05T00:00:00Z") },
      audit: async () => {},
    };

    setExpenseDepsFactoryForTests(() => deps);
    setPrincipalForTests(testPrincipal());
    await expect(loadTransactionDetail("00000000-0000-7000-8000-000000000099")).rejects.toThrow("boom");
    setExpenseDepsFactoryForTests(null);
    setPrincipalForTests(null);
  });
});

describe("loadRecurringPatterns", () => {
  it("flattens a stored pattern's dates to ISO strings", async () => {
    const deps = {
      transactions: new MemoryTransactionsRepository(),
      categories: new MemoryCategoriesRepository(),
      labels: new MemoryLabelsRepository(),
      recurring: new MemoryRecurringPatternsRepository(),
      clock: { now: () => new Date("2026-09-05T00:00:00Z") },
      audit: async () => {},
    };
    await deps.recurring.replaceAll("00000000-0000-7000-8000-000000000001", [
      {
        payee: "Netflix",
        cadence: "monthly",
        amountLow: "-15.99",
        amountHigh: "-15.99",
        currency: "EUR",
        sign: "-",
        lastSeenAt: new Date("2026-08-01T00:00:00Z"),
        nextExpectedAt: new Date("2026-09-01T00:00:00Z"),
        occurrenceCount: 4,
      },
    ]);

    setExpenseDepsFactoryForTests(() => deps);
    setPrincipalForTests(testPrincipal());
    const rows = await loadRecurringPatterns();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ payee: "Netflix", cadence: "monthly", occurrenceCount: 4 });
    expect(rows[0]!.lastSeenAt).toBe("2026-08-01T00:00:00.000Z");
    expect(rows[0]!.nextExpectedAt).toBe("2026-09-01T00:00:00.000Z");
    setExpenseDepsFactoryForTests(null);
    setPrincipalForTests(null);
  });
});
