import { describe, expect, it } from "vitest";
import { PermissionDeniedError } from "@/platform/auth/principal";
import { testPrincipal } from "@/test/principal";
import { MemoryCategoriesRepository, MemoryLabelsRepository, MemoryRecurringPatternsRepository, MemoryTransactionsRepository } from "../infrastructure/memory-repositories";
import { listTransactions } from "./list-transactions";

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

describe("listTransactions", () => {
  it("attaches each transaction's category and labels", async () => {
    const deps = harness();
    const userId = testPrincipal().userId;
    const category = await deps.categories.create({ userId, name: "Groceries", groupName: null, kind: "expense", color: null, parentId: null, source: "manual", archivedAt: null });
    if (category === "duplicate_name") throw new Error("unexpected duplicate_name");
    const created = await deps.transactions.create({ userId, accountId: "acc-1", occurredAt: new Date(), bookedAt: null, amount: "-10.00", currency: "EUR", type: "expense", state: "cleared", categoryId: category.id, payee: null, note: null, transferGroupId: null, source: "manual", syncRunId: null });
    await deps.transactions.setLabels(userId, created.id, ["label-1"]);

    const result = await listTransactions(deps)(testPrincipal(), {});
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.category?.name).toBe("Groceries");
    expect(result.items[0]!.labelIds).toEqual(["label-1"]);
  });

  it("denies a principal without expenses.read", async () => {
    const deps = harness();
    await expect(listTransactions(deps)(testPrincipal({ roles: [] }), {})).rejects.toThrow(PermissionDeniedError);
  });
});
