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
    const stored = await repo.get("u1", created.id);
    expect(stored?.note).toBeNull();
    expect(stored?.version).toBe(created.version);
  });

  it("tie-breaks equal occurredAt by insertion order (newest created first), matching time-ordered uuidv7 ids", async () => {
    const repo = new MemoryTransactionsRepository();
    const sameDay = new Date("2026-09-01T00:00:00Z");
    const first = await repo.create(tx({ occurredAt: sameDay }));
    const second = await repo.create(tx({ occurredAt: sameDay }));
    const page = await repo.list("u1", {});
    expect(page.items.map((t) => t.id)).toEqual([second.id, first.id]);
  });

  it("setLabels and labelsFor round-trip", async () => {
    const repo = new MemoryTransactionsRepository();
    const created = await repo.create(tx());
    await repo.setLabels("u1", created.id, ["label-1", "label-2"]);
    const map = await repo.labelsFor("u1", [created.id]);
    expect(map.get(created.id)?.sort()).toEqual(["label-1", "label-2"]);
  });

  it("labelsFor filters by userId explicitly: another user's id comes back empty, matching the Drizzle repository's join", async () => {
    const repo = new MemoryTransactionsRepository();
    const mine = await repo.create(tx({ userId: "u1" }));
    const theirs = await repo.create(tx({ userId: "u2" }));
    await repo.setLabels("u2", theirs.id, ["label-1"]);

    const map = await repo.labelsFor("u1", [mine.id, theirs.id]);
    expect(map.get(mine.id)).toEqual([]);
    expect(map.get(theirs.id)).toEqual([]);
    expect((await repo.labelsFor("u2", [theirs.id])).get(theirs.id)).toEqual(["label-1"]);
  });

  it("a cursor anchors on the (occurredAt, id) sort key regardless of filters, matching the Drizzle repository's tuple comparison", async () => {
    const repo = new MemoryTransactionsRepository();
    // The middle transaction by date is excluded from the `type: "expense"`
    // filter below, so it never appears in the filtered list itself — but a
    // cursor pointing at it must still anchor the page on its (occurredAt,
    // id) position, the same way the Drizzle repository's SQL tuple
    // comparison does (the anchor row is looked up independently of the
    // other filters). The old index-within-filtered-array approach would
    // have failed to find it and silently restarted from the top instead.
    const oldest = await repo.create(tx({ occurredAt: new Date("2026-09-01T00:00:00Z"), type: "expense" }));
    const excludedAnchor = await repo.create(tx({ occurredAt: new Date("2026-09-02T00:00:00Z"), type: "income" }));
    const newest = await repo.create(tx({ occurredAt: new Date("2026-09-03T00:00:00Z"), type: "expense" }));

    const page = await repo.list("u1", { type: "expense", cursor: excludedAnchor.id });
    expect(page.items.map((t) => t.id)).toEqual([oldest.id]);
    // Sanity check: without the cursor, both expense rows are present.
    expect((await repo.list("u1", { type: "expense" })).items.map((t) => t.id)).toEqual([newest.id, oldest.id]);
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

  it("rejects a duplicate (userId, name) with duplicate_name, matching the Drizzle repository's unique index", async () => {
    const categories = new MemoryCategoriesRepository();
    const first = await categories.create({ userId: "u1", name: "Groceries", groupName: null, kind: "expense", color: null, parentId: null, source: "manual", archivedAt: null });
    expect(first).not.toBe("duplicate_name");
    expect(await categories.create({ userId: "u1", name: "Groceries", groupName: null, kind: "expense", color: null, parentId: null, source: "manual", archivedAt: null })).toBe("duplicate_name");
    // A different user, or a different name, is unaffected.
    expect(await categories.create({ userId: "u2", name: "Groceries", groupName: null, kind: "expense", color: null, parentId: null, source: "manual", archivedAt: null })).not.toBe("duplicate_name");
    expect(await categories.list("u1")).toHaveLength(1);

    const labels = new MemoryLabelsRepository();
    const firstLabel = await labels.create({ userId: "u1", name: "Recurring", color: null, source: "manual" });
    expect(firstLabel).not.toBe("duplicate_name");
    expect(await labels.create({ userId: "u1", name: "Recurring", color: null, source: "manual" })).toBe("duplicate_name");
    expect(await labels.create({ userId: "u2", name: "Recurring", color: null, source: "manual" })).not.toBe("duplicate_name");
    expect(await labels.list("u1")).toHaveLength(1);
  });
});

describe("MemoryRecurringPatternsRepository", () => {
  it("replaceAll discards the previous set for that user only", async () => {
    const repo = new MemoryRecurringPatternsRepository();
    await repo.replaceAll("u1", [
      { payee: "Netflix", cadence: "monthly", amountLow: "-15.99", amountHigh: "-15.99", currency: "EUR", lastSeenAt: new Date(), nextExpectedAt: new Date(), occurrenceCount: 4 },
    ]);
    await repo.replaceAll("u2", [
      { payee: "Spotify", cadence: "monthly", amountLow: "-9.99", amountHigh: "-9.99", currency: "EUR", lastSeenAt: new Date(), nextExpectedAt: new Date(), occurrenceCount: 4 },
    ]);
    await repo.replaceAll("u1", []);
    expect(await repo.list("u1")).toEqual([]);
    expect((await repo.list("u2")).map((p) => p.payee)).toEqual(["Spotify"]);
  });
});
