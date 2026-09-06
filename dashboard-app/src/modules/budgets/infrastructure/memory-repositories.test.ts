import { describe, expect, it } from "vitest";
import { VersionMismatchError } from "../application/errors";
import {
  MemoryAllocationsRepository,
  MemoryAmountVersionsRepository,
  MemoryBudgetsRepository,
  MemoryEventsRepository,
  MemoryScopesRepository,
  MemoryUsagesRepository,
} from "./memory-repositories";

const budget = (name: string, over: Partial<Parameters<MemoryBudgetsRepository["create"]>[0]> = {}) => ({
  userId: "user-1",
  name,
  description: null,
  currency: "EUR",
  periodKind: "monthly" as const,
  startDate: "2026-01-01",
  endDate: null,
  goalAmount: null,
  labels: [],
  ...over,
});

describe("MemoryBudgetsRepository", () => {
  it("orders active budgets by name and includes archives only when requested", async () => {
    const repo = new MemoryBudgetsRepository();
    const zulu = await repo.create(budget("Zulu"));
    await repo.create(budget("Alpha"));
    await repo.update("user-1", zulu.id, 1, { status: "archived", archivedAt: new Date("2026-02-01T00:00:00Z") });
    expect((await repo.list("user-1")).map((row) => row.name)).toEqual(["Alpha"]);
    expect((await repo.list("user-1", { includeArchived: true })).map((row) => row.name)).toEqual(["Alpha", "Zulu"]);
  });

  it("bumps version, normalizes the goal amount, and throws VersionMismatchError for a stale update", async () => {
    const repo = new MemoryBudgetsRepository();
    const created = await repo.create(budget("Groceries", { goalAmount: "500" }));
    expect(created.goalAmount).toBe("500.00");
    const updated = await repo.update("user-1", created.id, created.version, { goalAmount: "600" });
    expect(updated).toMatchObject({ goalAmount: "600.00", version: 2 });
    await expect(repo.update("user-1", created.id, 1, { name: "Stale" })).rejects.toBeInstanceOf(VersionMismatchError);
  });

  it("does not leak another user's budgets", async () => {
    const repo = new MemoryBudgetsRepository();
    await repo.create(budget("Mine"));
    expect(await repo.get("user-2", (await repo.list("user-1"))[0]!.id)).toBeNull();
  });
});

describe("MemoryAmountVersionsRepository", () => {
  it("orders by effectiveFrom and upserts on (budgetId, effectiveFrom)", async () => {
    const repo = new MemoryAmountVersionsRepository();
    const later = await repo.add({ budgetId: "b1", initialAmount: "100", effectiveFrom: "2026-03-01", reason: null, actorUserId: null });
    await repo.add({ budgetId: "b1", initialAmount: "50", effectiveFrom: "2026-01-01", reason: null, actorUserId: null });
    const replaced = await repo.add({ budgetId: "b1", initialAmount: "150.5", effectiveFrom: "2026-03-01", reason: "raised", actorUserId: null });
    expect(replaced).toMatchObject({ id: later.id, initialAmount: "150.50" });
    expect((await repo.listForBudget("b1")).map((row) => row.effectiveFrom)).toEqual(["2026-01-01", "2026-03-01"]);
  });
});

describe("MemoryAllocationsRepository", () => {
  it("orders allocations by effectiveFrom then id", async () => {
    const budgets = new MemoryBudgetsRepository();
    const repo = new MemoryAllocationsRepository(budgets);
    const b = await budgets.create(budget("Groceries"));
    await repo.create({ budgetId: b.id, sourceKind: "none", sourceId: null, amount: "10", recurrence: "once", effectiveFrom: "2026-03-01", effectiveTo: null, note: null, actorUserId: null });
    await repo.create({ budgetId: b.id, sourceKind: "none", sourceId: null, amount: "20", recurrence: "once", effectiveFrom: "2026-01-01", effectiveTo: null, note: null, actorUserId: null });
    expect((await repo.listForBudget(b.id)).map((row) => row.effectiveFrom)).toEqual(["2026-01-01", "2026-03-01"]);
  });

  it("spans a user's budgets and excludes another user's allocations against the same source", async () => {
    const budgets = new MemoryBudgetsRepository();
    const repo = new MemoryAllocationsRepository(budgets);
    const bA1 = await budgets.create(budget("A1", { userId: "user-a" }));
    const bA2 = await budgets.create(budget("A2", { userId: "user-a" }));
    const bB = await budgets.create(budget("B1", { userId: "user-b" }));
    await repo.create({ budgetId: bA1.id, sourceKind: "account", sourceId: "acc-1", amount: "10", recurrence: "once", effectiveFrom: "2026-01-01", effectiveTo: null, note: null, actorUserId: null });
    await repo.create({ budgetId: bA2.id, sourceKind: "account", sourceId: "acc-1", amount: "20", recurrence: "once", effectiveFrom: "2026-02-01", effectiveTo: null, note: null, actorUserId: null });
    await repo.create({ budgetId: bB.id, sourceKind: "account", sourceId: "acc-1", amount: "30", recurrence: "once", effectiveFrom: "2026-01-01", effectiveTo: null, note: null, actorUserId: null });
    const rows = await repo.listAgainstSource("user-a", "account", "acc-1");
    expect(rows.map((row) => row.budgetId)).toEqual([bA1.id, bA2.id]);
  });

  it("bumps version and throws VersionMismatchError for a stale update", async () => {
    const budgets = new MemoryBudgetsRepository();
    const repo = new MemoryAllocationsRepository(budgets);
    const b = await budgets.create(budget("Groceries"));
    const created = await repo.create({ budgetId: b.id, sourceKind: "none", sourceId: null, amount: "10", recurrence: "once", effectiveFrom: "2026-01-01", effectiveTo: null, note: null, actorUserId: null });
    const updated = await repo.update(b.id, created.id, created.version, { effectiveTo: "2026-06-01" });
    expect(updated).toMatchObject({ effectiveTo: "2026-06-01", version: 2 });
    await expect(repo.update(b.id, created.id, 1, { note: "stale" })).rejects.toBeInstanceOf(VersionMismatchError);
  });
});

describe("MemoryScopesRepository", () => {
  it("fully replaces the scope set for a budget", async () => {
    const repo = new MemoryScopesRepository();
    await repo.replace("b1", [{ kind: "account", refId: "acc-1" }]);
    const replaced = await repo.replace("b1", [{ kind: "category", refId: "cat-1" }, { kind: "label", refId: "lbl-1" }]);
    expect(replaced).toHaveLength(2);
    expect((await repo.listForBudget("b1")).map((row) => row.kind)).toEqual(expect.arrayContaining(["category", "label"]));
  });
});

describe("MemoryUsagesRepository", () => {
  it("orders usages by occurredAt then id and filters by range", async () => {
    const repo = new MemoryUsagesRepository();
    await repo.create({ budgetId: "b1", transactionId: null, amount: "10", occurredAt: "2026-01-15", matchedBy: "manual", note: "later" });
    await repo.create({ budgetId: "b1", transactionId: null, amount: "5", occurredAt: "2026-01-01", matchedBy: "manual", note: "earlier" });
    expect((await repo.listForBudget("b1")).map((row) => row.occurredAt)).toEqual(["2026-01-01", "2026-01-15"]);
    expect((await repo.listForBudget("b1", { from: "2026-01-10" })).map((row) => row.note)).toEqual(["later"]);
  });

  it("deletes a usage and reports whether one existed", async () => {
    const repo = new MemoryUsagesRepository();
    const row = await repo.create({ budgetId: "b1", transactionId: null, amount: "10", occurredAt: "2026-01-01", matchedBy: "manual", note: null });
    await expect(repo.delete("b1", row.id)).resolves.toBe(true);
    await expect(repo.delete("b1", row.id)).resolves.toBe(false);
  });

  describe("replaceScopeMatched", () => {
    it("inserts new transactions, updates changed amounts, deletes absent rows, and never touches manual rows", async () => {
      const repo = new MemoryUsagesRepository();
      const manual = await repo.create({ budgetId: "b1", transactionId: null, amount: "999", occurredAt: "2026-01-01", matchedBy: "manual", note: "manual entry" });
      const stale = await repo.create({ budgetId: "b1", transactionId: "tx-stale", amount: "10.00", occurredAt: "2026-01-05", matchedBy: "scope", note: null });
      const changed = await repo.create({ budgetId: "b1", transactionId: "tx-changed", amount: "10.00", occurredAt: "2026-01-06", matchedBy: "scope", note: null });

      const result = await repo.replaceScopeMatched("b1", [
        { transactionId: "tx-changed", amount: "15.00", occurredAt: "2026-01-06" },
        { transactionId: "tx-new", amount: "20.00", occurredAt: "2026-01-07" },
      ]);

      expect(result).toEqual({ inserted: 1, updated: 1, deleted: 1 });
      const rows = await repo.listForBudget("b1");
      expect(rows.map((row) => row.transactionId).sort()).toEqual([null, "tx-changed", "tx-new"].sort());
      expect(rows.find((row) => row.id === manual.id)).toMatchObject({ amount: "999.00" });
      expect(rows.find((row) => row.transactionId === "tx-changed")).toMatchObject({ id: changed.id, amount: "15.00" });
      expect(rows.find((row) => row.transactionId === "tx-stale")).toBeUndefined();
      expect(stale.id).toBeTruthy();
    });

    it("is a no-op when nothing changed", async () => {
      const repo = new MemoryUsagesRepository();
      await repo.create({ budgetId: "b1", transactionId: "tx-1", amount: "10.00", occurredAt: "2026-01-01", matchedBy: "scope", note: null });
      const result = await repo.replaceScopeMatched("b1", [{ transactionId: "tx-1", amount: "10.00", occurredAt: "2026-01-01" }]);
      expect(result).toEqual({ inserted: 0, updated: 0, deleted: 0 });
    });

    it("does not touch usages belonging to a different budget", async () => {
      const repo = new MemoryUsagesRepository();
      await repo.create({ budgetId: "other", transactionId: "tx-1", amount: "10.00", occurredAt: "2026-01-01", matchedBy: "scope", note: null });
      const result = await repo.replaceScopeMatched("b1", []);
      expect(result).toEqual({ inserted: 0, updated: 0, deleted: 0 });
      expect(await repo.listForBudget("other")).toHaveLength(1);
    });
  });
});

describe("MemoryEventsRepository", () => {
  it("orders events by createdAt desc and respects a limit", async () => {
    const repo = new MemoryEventsRepository();
    await repo.add({ budgetId: "b1", kind: "created", detail: {}, actorUserId: null });
    await repo.add({ budgetId: "b1", kind: "updated", detail: {}, actorUserId: null });
    await repo.add({ budgetId: "b1", kind: "archived", detail: {}, actorUserId: null });
    const kinds = (await repo.listForBudget("b1")).map((row) => row.kind);
    expect(kinds).toEqual(["archived", "updated", "created"]);
    expect((await repo.listForBudget("b1", 2)).map((row) => row.kind)).toEqual(["archived", "updated"]);
  });
});
