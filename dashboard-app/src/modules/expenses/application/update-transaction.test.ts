import { describe, expect, it } from "vitest";
import { testPrincipal } from "@/test/principal";
import { MemoryCategoriesRepository, MemoryLabelsRepository, MemoryRecurringPatternsRepository, MemoryTransactionsRepository } from "../infrastructure/memory-repositories";
import { InvalidInputError, VersionMismatchError } from "./errors";
import { updateTransaction } from "./update-transaction";

function harness() {
  const labels = new MemoryLabelsRepository();
  return {
    // Wired with `labels` so `setLabels`'s ownership predicate (A5) is
    // actually exercised here, the way the Drizzle repository always
    // enforces it — a bare `new MemoryTransactionsRepository()` would let
    // any labelId through and hide the divergence this suite exists to catch.
    transactions: new MemoryTransactionsRepository(labels),
    categories: new MemoryCategoriesRepository(),
    labels,
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
    const label = await deps.labels.create({ userId, name: "Work", color: null, source: "manual" });
    if (label === "duplicate_name") throw new Error("unexpected duplicate_name");
    const updated = await updateTransaction(deps)(testPrincipal(), created.id, created.version, { categoryId: category.id, note: "Morning coffee", labelIds: [label.id] });
    expect(updated.categoryId).toBe(category.id);
    expect(updated.note).toBe("Morning coffee");
    expect((await deps.transactions.labelsFor(userId, [created.id])).get(created.id)).toEqual([label.id]);
  });

  it("throws VersionMismatchError on a stale version", async () => {
    const deps = harness();
    const created = await deps.transactions.create({ userId: testPrincipal().userId, accountId: "acc-1", occurredAt: new Date(), bookedAt: null, amount: "-1.00", currency: "EUR", type: "expense", state: "cleared", categoryId: null, payee: null, note: null, transferGroupId: null, source: "manual", syncRunId: null });
    await expect(updateTransaction(deps)(testPrincipal(), created.id, created.version + 1, { note: "x" })).rejects.toThrow(VersionMismatchError);
  });

  // A5: label and category ownership is enforced nowhere before this fix — a
  // PATCH carrying another user's labelId/categoryId would succeed and write
  // a cross-tenant row, since a foreign key check is not subject to RLS.
  it("refuses another user's categoryId with InvalidInputError, and leaves the transaction untouched", async () => {
    const deps = harness();
    const owner = testPrincipal({ userId: "00000000-0000-7000-8000-000000000001" });
    const intruderCategory = await deps.categories.create({
      userId: "00000000-0000-7000-8000-0000000000ff",
      name: "Not yours",
      groupName: null,
      kind: "expense",
      color: null,
      parentId: null,
      source: "manual",
      archivedAt: null,
    });
    if (intruderCategory === "duplicate_name") throw new Error("unexpected duplicate_name");
    const created = await deps.transactions.create({ userId: owner.userId, accountId: "acc-1", occurredAt: new Date(), bookedAt: null, amount: "-1.00", currency: "EUR", type: "expense", state: "cleared", categoryId: null, payee: null, note: null, transferGroupId: null, source: "manual", syncRunId: null });
    await expect(
      updateTransaction(deps)(owner, created.id, created.version, { categoryId: intruderCategory.id }),
    ).rejects.toThrow(InvalidInputError);
    expect((await deps.transactions.get(owner.userId, created.id))?.categoryId).toBeNull();
  });

  it("refuses another user's labelId with InvalidInputError, and does not link it", async () => {
    const deps = harness();
    const owner = testPrincipal({ userId: "00000000-0000-7000-8000-000000000001" });
    const intruderLabel = await deps.labels.create({ userId: "00000000-0000-7000-8000-0000000000ff", name: "Not yours", color: null, source: "manual" });
    if (intruderLabel === "duplicate_name") throw new Error("unexpected duplicate_name");
    const created = await deps.transactions.create({ userId: owner.userId, accountId: "acc-1", occurredAt: new Date(), bookedAt: null, amount: "-1.00", currency: "EUR", type: "expense", state: "cleared", categoryId: null, payee: null, note: null, transferGroupId: null, source: "manual", syncRunId: null });
    await expect(
      updateTransaction(deps)(owner, created.id, created.version, { labelIds: [intruderLabel.id] }),
    ).rejects.toThrow(InvalidInputError);
    expect((await deps.transactions.labelsFor(owner.userId, [created.id])).get(created.id)).toEqual([]);
  });
});
