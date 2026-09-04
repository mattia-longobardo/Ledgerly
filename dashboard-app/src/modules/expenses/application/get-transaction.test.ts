import { describe, expect, it } from "vitest";
import { testPrincipal } from "@/test/principal";
import { MemoryCategoriesRepository, MemoryLabelsRepository, MemoryRecurringPatternsRepository, MemoryTransactionsRepository } from "../infrastructure/memory-repositories";
import { NotFoundError } from "./errors";
import { getTransaction } from "./get-transaction";

function harness() {
  return {
    transactions: new MemoryTransactionsRepository(),
    categories: new MemoryCategoriesRepository(),
    labels: new MemoryLabelsRepository(),
    recurring: new MemoryRecurringPatternsRepository(),
    clock: { now: () => new Date() },
    audit: async () => {},
  };
}

describe("getTransaction", () => {
  it("throws NotFoundError for a transaction belonging to someone else", async () => {
    const deps = harness();
    const created = await deps.transactions.create({ userId: "other-user", accountId: "acc-1", occurredAt: new Date(), bookedAt: null, amount: "-1.00", currency: "EUR", type: "expense", state: "cleared", categoryId: null, payee: null, note: null, transferGroupId: null, source: "manual", syncRunId: null });
    await expect(getTransaction(deps)(testPrincipal(), created.id)).rejects.toThrow(NotFoundError);
  });
});
