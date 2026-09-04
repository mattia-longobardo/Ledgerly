import { describe, expect, it } from "vitest";
import { testPrincipal } from "@/test/principal";
import { MemoryCategoriesRepository, MemoryLabelsRepository, MemoryRecurringPatternsRepository, MemoryTransactionsRepository } from "../infrastructure/memory-repositories";
import { listCategories } from "./list-categories";
import { listLabels } from "./list-labels";

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

describe("listCategories and listLabels", () => {
  it("return only the caller's own rows, alphabetised", async () => {
    const deps = harness();
    const userId = testPrincipal().userId;
    await deps.categories.create({ userId, name: "Zoo", groupName: null, kind: "expense", color: null, parentId: null, source: "manual", archivedAt: null });
    await deps.categories.create({ userId, name: "Air travel", groupName: null, kind: "expense", color: null, parentId: null, source: "manual", archivedAt: null });
    await deps.categories.create({ userId: "other", name: "Middle", groupName: null, kind: "expense", color: null, parentId: null, source: "manual", archivedAt: null });
    const categories = await listCategories(deps)(testPrincipal());
    expect(categories.map((c) => c.name)).toEqual(["Air travel", "Zoo"]);

    await deps.labels.create({ userId, name: "Work", color: null, source: "manual" });
    const labels = await listLabels(deps)(testPrincipal());
    expect(labels.map((l) => l.name)).toEqual(["Work"]);
  });
});
