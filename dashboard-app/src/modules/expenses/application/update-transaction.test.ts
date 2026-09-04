import { describe, expect, it } from "vitest";
import { testPrincipal } from "@/test/principal";
import { MemoryCategoriesRepository, MemoryLabelsRepository, MemoryRecurringPatternsRepository, MemoryTransactionsRepository } from "../infrastructure/memory-repositories";
import { VersionMismatchError } from "./errors";
import { updateTransaction } from "./update-transaction";

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

describe("updateTransaction", () => {
  it("recategorises, sets a note and replaces labels in one call", async () => {
    const deps = harness();
    const userId = testPrincipal().userId;
    const created = await deps.transactions.create({ userId, accountId: "acc-1", occurredAt: new Date(), bookedAt: null, amount: "-1.00", currency: "EUR", type: "expense", state: "cleared", categoryId: null, payee: null, note: null, transferGroupId: null, source: "manual", syncRunId: null });
    const category = await deps.categories.create({ userId, name: "Coffee", groupName: null, kind: "expense", color: null, parentId: null, source: "manual", archivedAt: null });
    if (category === "duplicate_name") throw new Error("unexpected duplicate_name");
    const updated = await updateTransaction(deps)(testPrincipal(), created.id, created.version, { categoryId: category.id, note: "Morning coffee", labelIds: ["l1"] });
    expect(updated.categoryId).toBe(category.id);
    expect(updated.note).toBe("Morning coffee");
    expect((await deps.transactions.labelsFor(userId, [created.id])).get(created.id)).toEqual(["l1"]);
  });

  it("throws VersionMismatchError on a stale version", async () => {
    const deps = harness();
    const created = await deps.transactions.create({ userId: testPrincipal().userId, accountId: "acc-1", occurredAt: new Date(), bookedAt: null, amount: "-1.00", currency: "EUR", type: "expense", state: "cleared", categoryId: null, payee: null, note: null, transferGroupId: null, source: "manual", syncRunId: null });
    await expect(updateTransaction(deps)(testPrincipal(), created.id, created.version + 1, { note: "x" })).rejects.toThrow(VersionMismatchError);
  });
});
