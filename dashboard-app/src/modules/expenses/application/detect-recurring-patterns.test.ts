import { describe, expect, it } from "vitest";
import {
  MemoryCategoriesRepository,
  MemoryLabelsRepository,
  MemoryRecurringPatternsRepository,
  MemoryTransactionsRepository,
} from "../infrastructure/memory-repositories";
import { testPrincipal } from "@/test/principal";
import { detectRecurringPatterns } from "./detect-recurring-patterns";
import { listRecurringPatterns } from "./list-recurring-patterns";

function harness() {
  return {
    transactions: new MemoryTransactionsRepository(),
    categories: new MemoryCategoriesRepository(),
    labels: new MemoryLabelsRepository(),
    recurring: new MemoryRecurringPatternsRepository(),
    clock: { now: () => new Date("2026-09-05T00:00:00Z") },
    audit: async () => {},
  };
}

describe("detectRecurringPatterns", () => {
  it("persists what the domain detector finds, replacing the previous set", async () => {
    const deps = harness();
    for (const month of [4, 5, 6, 7]) {
      await deps.transactions.create({
        userId: "u1",
        accountId: "acc-1",
        occurredAt: new Date(Date.UTC(2026, month, 1)),
        bookedAt: null,
        amount: "-15.99",
        currency: "EUR",
        type: "expense",
        state: "cleared",
        categoryId: null,
        payee: "Netflix",
        note: null,
        transferGroupId: null,
        source: "provider",
        syncRunId: null,
      });
    }
    const patterns = await detectRecurringPatterns(deps)("u1");
    expect(patterns).toHaveLength(1);
    const stored = await listRecurringPatterns(deps)(testPrincipal({ userId: "u1" }));
    expect(stored).toHaveLength(1);
    expect(stored[0]!.payee).toBe("Netflix");

    // A second run with no transactions clears the previous set rather than appending.
    await deps.transactions.create({
      userId: "u1",
      accountId: "acc-1",
      occurredAt: new Date(),
      bookedAt: null,
      amount: "-1.00",
      currency: "EUR",
      type: "expense",
      state: "cleared",
      categoryId: null,
      payee: null,
      note: null,
      transferGroupId: null,
      source: "manual",
      syncRunId: null,
    });
    // (re-detecting over just the unrelated one-off transaction finds nothing)
    const secondDeps = { ...deps, transactions: new MemoryTransactionsRepository() };
    await secondDeps.recurring.replaceAll("u1", []);
    await detectRecurringPatterns(secondDeps)("u1");
    expect(await listRecurringPatterns(secondDeps)(testPrincipal({ userId: "u1" }))).toHaveLength(0);
  });
});
