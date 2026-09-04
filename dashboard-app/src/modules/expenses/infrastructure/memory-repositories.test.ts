import { describe, expect, it } from "vitest";
import {
  MemoryTransactionsRepository,
  MemoryCategoriesRepository,
  MemoryLabelsRepository,
  MemoryRecurringPatternsRepository,
} from "./memory-repositories";

function tx(overrides: Partial<Parameters<MemoryTransactionsRepository["create"]>[0]> = {}) {
  return {
    userId: "u1",
    accountId: "acc-1",
    occurredAt: new Date("2026-09-01T00:00:00Z"),
    bookedAt: null,
    amount: "-10.00",
    currency: "EUR",
    type: "expense" as const,
    state: "cleared" as const,
    categoryId: null,
    payee: "Shop",
    note: null,
    transferGroupId: null,
    source: "manual" as const,
    syncRunId: null,
    ...overrides,
  };
}

describe("MemoryTransactionsRepository", () => {
  it("lists newest-occurred-first, tied by id descending, matching the Drizzle repository's ORDER BY", async () => {
    const repo = new MemoryTransactionsRepository();
    const a = await repo.create(tx({ occurredAt: new Date("2026-09-01T00:00:00Z") }));
    const b = await repo.create(tx({ occurredAt: new Date("2026-09-03T00:00:00Z") }));
    const c = await repo.create(tx({ occurredAt: new Date("2026-09-02T00:00:00Z") }));
    const page = await repo.list("u1", {});
    expect(page.items.map((t) => t.id)).toEqual([b.id, c.id, a.id]);
  });

  it("paginates with a cursor that is the last item's id, and reports nextCursor only when more remain", async () => {
    const repo = new MemoryTransactionsRepository();
    for (let i = 0; i < 3; i += 1) {
      await repo.create(tx({ occurredAt: new Date(Date.UTC(2026, 8, i + 1)) }));
    }
    const first = await repo.list("u1", { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await repo.list("u1", { limit: 2, cursor: first.nextCursor });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
  });

  it("update rejects a stale version without applying the patch", async () => {
    const repo = new MemoryTransactionsRepository();
    const created = await repo.create(tx());
    const result = await repo.update("u1", created.id, created.version + 1, { note: "x" });
    expect(result).toBe("version_mismatch");
  });

  it("setLabels and labelsFor round-trip", async () => {
    const repo = new MemoryTransactionsRepository();
    const created = await repo.create(tx());
    await repo.setLabels("u1", created.id, ["label-1", "label-2"]);
    const map = await repo.labelsFor("u1", [created.id]);
    expect(map.get(created.id)?.sort()).toEqual(["label-1", "label-2"]);
  });
});

describe("MemoryCategoriesRepository and MemoryLabelsRepository", () => {
  it("finds an existing category or label by case-sensitive exact name", async () => {
    const categories = new MemoryCategoriesRepository();
    await categories.create({ userId: "u1", name: "Groceries", groupName: null, kind: "expense", color: null, parentId: null, source: "manual", archivedAt: null });
    expect(await categories.findByName("u1", "Groceries")).not.toBeNull();
    expect(await categories.findByName("u1", "groceries")).toBeNull();

    const labels = new MemoryLabelsRepository();
    await labels.create({ userId: "u1", name: "Recurring", color: null, source: "manual" });
    expect(await labels.findByName("u1", "Recurring")).not.toBeNull();
  });
});

describe("MemoryRecurringPatternsRepository", () => {
  it("replaceAll discards the previous set for that user only", async () => {
    const repo = new MemoryRecurringPatternsRepository();
    await repo.replaceAll("u1", [
      { payee: "Netflix", cadence: "monthly", amountLow: "-15.99", amountHigh: "-15.99", currency: "EUR", lastSeenAt: new Date(), nextExpectedAt: new Date(), occurrenceCount: 4 },
    ]);
    await repo.replaceAll("u1", []);
    expect(await repo.list("u1")).toEqual([]);
  });
});
