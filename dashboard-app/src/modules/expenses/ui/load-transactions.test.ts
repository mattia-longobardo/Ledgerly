import { describe, expect, it } from "vitest";
import {
  MemoryCategoriesRepository,
  MemoryLabelsRepository,
  MemoryRecurringPatternsRepository,
  MemoryTransactionsRepository,
} from "../infrastructure/memory-repositories";
import { testPrincipal } from "@/test/principal";
import { setExpenseDepsFactoryForTests, setPrincipalForTests } from "./run";
import { loadTransactionsPage } from "./load-transactions";

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
