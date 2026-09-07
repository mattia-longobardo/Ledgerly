import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "@/lib/db/client";
import {
  accountBalances,
  accounts,
  funds,
  organizations,
  transactionCategories,
  transactionLabelLinks,
  transactionLabels,
  transactions,
  users,
} from "@/lib/db/schema";
import { withSystemContext } from "@/platform/db/context";
import { closeDb, resetDb, testDb } from "@/test/db";
import { VersionMismatchError } from "../application/errors";
import type {
  AllocationsRepository,
  AmountVersionsRepository,
  Budget,
  BudgetsRepository,
  EventsRepository,
  ScopesRepository,
  UsagesRepository,
} from "../application/ports";
import { DrizzleAllocationsRepository, DrizzleAmountVersionsRepository } from "./drizzle-allocations-repository";
import { DrizzleBudgetsRepository } from "./drizzle-budgets-repository";
import { DrizzleEventsRepository } from "./drizzle-events-repository";
import { DrizzleScopesRepository, DrizzleUsagesRepository } from "./drizzle-scopes-usages-repository";
import {
  MemoryAllocationsRepository,
  MemoryAmountVersionsRepository,
  MemoryBudgetsRepository,
  MemoryEventsRepository,
  MemoryScopesRepository,
  MemoryUsagesRepository,
} from "./memory-repositories";
import { drizzleOwnershipCheck } from "./ownership-check";
import { drizzleSourceBalanceSource } from "./source-balance-source";
import { drizzleTransactionsScopeSource } from "./transactions-scope-source";

interface Repositories {
  budgets: BudgetsRepository;
  versions: AmountVersionsRepository;
  allocations: AllocationsRepository;
  scopes: ScopesRepository;
  usages: UsagesRepository;
  events: EventsRepository;
}

async function seedUser(displayName: string): Promise<string> {
  const db = await testDb();
  const [org] = await db.insert(organizations).values({ name: `${displayName} org` }).returning();
  const [user] = await db.insert(users).values({ organizationId: org!.id, displayName }).returning();
  return user!.id;
}

function memoryRepositories(): Repositories {
  const budgets = new MemoryBudgetsRepository();
  return {
    budgets,
    versions: new MemoryAmountVersionsRepository(),
    allocations: new MemoryAllocationsRepository(budgets),
    scopes: new MemoryScopesRepository(),
    usages: new MemoryUsagesRepository(),
    events: new MemoryEventsRepository(),
  };
}

function drizzleRepositories(tx: DbClient): Repositories {
  return {
    budgets: new DrizzleBudgetsRepository(tx),
    versions: new DrizzleAmountVersionsRepository(tx),
    allocations: new DrizzleAllocationsRepository(tx),
    scopes: new DrizzleScopesRepository(tx),
    usages: new DrizzleUsagesRepository(tx),
    events: new DrizzleEventsRepository(tx),
  };
}

async function runWithRepositories(
  backend: "memory" | "drizzle",
  test: (repos: Repositories, fixture: { userId: string }) => Promise<void>,
): Promise<void> {
  const userId = await seedUser(`${backend} user`);
  const db = await testDb();
  await withSystemContext(db, async (tx) => {
    const repos = backend === "memory" ? memoryRepositories() : drizzleRepositories(tx);
    await test(repos, { userId });
  });
}

function newBudget(userId: string, name: string, over: Partial<Parameters<BudgetsRepository["create"]>[0]> = {}) {
  return {
    userId,
    name,
    description: null,
    currency: "EUR",
    periodKind: "monthly" as const,
    startDate: "2026-01-01",
    endDate: null,
    goalAmount: null,
    labels: [],
    ...over,
  };
}

const BACKENDS = [{ backend: "memory" as const }, { backend: "drizzle" as const }];

describe.each(BACKENDS)("$backend budgets repository contract", ({ backend }) => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("orders by name, filters archives, and enforces optimistic versions", async () => {
    await runWithRepositories(backend, async ({ budgets }, { userId }) => {
      const zulu = await budgets.create(newBudget(userId, "Zulu"));
      const alpha = await budgets.create(newBudget(userId, "Alpha"));
      const archived = await budgets.update(userId, zulu.id, 1, { status: "archived", archivedAt: new Date("2026-02-01T00:00:00Z") });
      expect(archived?.version).toBe(2);
      expect((await budgets.list(userId)).map((row) => row.id)).toEqual([alpha.id]);
      expect((await budgets.list(userId, { includeArchived: true })).map((row) => row.name)).toEqual(["Alpha", "Zulu"]);
      await expect(budgets.update(userId, alpha.id, 5, { name: "Stale" })).rejects.toBeInstanceOf(VersionMismatchError);
      expect(await budgets.get(crypto.randomUUID(), alpha.id)).toBeNull();
    });
  });
});

describe.each(BACKENDS)("$backend amount versions repository contract", ({ backend }) => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("orders by effectiveFrom and upserts on (budgetId, effectiveFrom)", async () => {
    await runWithRepositories(backend, async ({ budgets, versions }, { userId }) => {
      const budget = await budgets.create(newBudget(userId, "Groceries"));
      const later = await versions.add({ budgetId: budget.id, initialAmount: "100", effectiveFrom: "2026-03-01", reason: null, actorUserId: null });
      await versions.add({ budgetId: budget.id, initialAmount: "50", effectiveFrom: "2026-01-01", reason: null, actorUserId: null });
      const replaced = await versions.add({ budgetId: budget.id, initialAmount: "150.5", effectiveFrom: "2026-03-01", reason: "raised", actorUserId: null });
      expect(replaced).toMatchObject({ id: later.id, initialAmount: "150.50" });
      expect((await versions.listForBudget(budget.id)).map((row) => row.effectiveFrom)).toEqual(["2026-01-01", "2026-03-01"]);
    });
  });
});

describe.each(BACKENDS)("$backend allocations repository contract", ({ backend }) => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("orders by effectiveFrom then id, and enforces optimistic versions", async () => {
    await runWithRepositories(backend, async ({ budgets, allocations }, { userId }) => {
      const budget = await budgets.create(newBudget(userId, "Groceries"));
      const alloc = (over: Partial<Parameters<AllocationsRepository["create"]>[0]> = {}) => allocations.create({
        budgetId: budget.id, sourceKind: "none" as const, sourceId: null, amount: "10", recurrence: "once" as const,
        effectiveFrom: "2026-03-01", effectiveTo: null, note: null, actorUserId: null, ...over,
      });
      await alloc();
      const first = await alloc({ effectiveFrom: "2026-01-01" });
      expect((await allocations.listForBudget(budget.id)).map((row) => row.effectiveFrom)).toEqual(["2026-01-01", "2026-03-01"]);
      const updated = await allocations.update(budget.id, first.id, first.version, { effectiveTo: "2026-06-01" });
      expect(updated).toMatchObject({ effectiveTo: "2026-06-01", version: 2 });
      await expect(allocations.update(budget.id, first.id, 1, { note: "stale" })).rejects.toBeInstanceOf(VersionMismatchError);
      expect(await allocations.update(budget.id, crypto.randomUUID(), 1, { note: "x" })).toBeNull();
    });
  });

  it("listAgainstSource spans two budgets of the same user and excludes another user's allocations against the same account id", async () => {
    const userA = await seedUser("A");
    const userB = await seedUser("B");
    const sourceId = crypto.randomUUID();
    const db = await testDb();
    await withSystemContext(db, async (tx) => {
      const repos = backend === "memory" ? memoryRepositories() : drizzleRepositories(tx);
      const b1 = await repos.budgets.create(newBudget(userA, "Budget 1"));
      const b2 = await repos.budgets.create(newBudget(userA, "Budget 2"));
      const bOther = await repos.budgets.create(newBudget(userB, "Other user's budget"));
      await repos.allocations.create({ budgetId: b1.id, sourceKind: "account", sourceId, amount: "10", recurrence: "once", effectiveFrom: "2026-02-01", effectiveTo: null, note: null, actorUserId: null });
      await repos.allocations.create({ budgetId: b2.id, sourceKind: "account", sourceId, amount: "20", recurrence: "once", effectiveFrom: "2026-01-01", effectiveTo: null, note: null, actorUserId: null });
      await repos.allocations.create({ budgetId: bOther.id, sourceKind: "account", sourceId, amount: "30", recurrence: "once", effectiveFrom: "2026-01-01", effectiveTo: null, note: null, actorUserId: null });
      const rows = await repos.allocations.listAgainstSource(userA, "account", sourceId);
      expect(rows.map((row) => row.budgetId)).toEqual([b2.id, b1.id]);
    });
  });
});

describe.each(BACKENDS)("$backend scopes repository contract", ({ backend }) => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("fully replaces the scope set for a budget", async () => {
    await runWithRepositories(backend, async ({ budgets, scopes }, { userId }) => {
      const budget = await budgets.create(newBudget(userId, "Groceries"));
      await scopes.replace(budget.id, [{ kind: "account", refId: crypto.randomUUID() }]);
      const replaced = await scopes.replace(budget.id, [{ kind: "category", refId: crypto.randomUUID() }, { kind: "label", refId: crypto.randomUUID() }]);
      expect(replaced).toHaveLength(2);
      const listed = await scopes.listForBudget(budget.id);
      expect(listed.map((row) => row.kind).sort()).toEqual(["category", "label"]);
      expect(listed.every((row) => row.budgetId === budget.id)).toBe(true);
    });
  });

  it("collapses a repeated {kind, refId} to one row, first occurrence winning", async () => {
    await runWithRepositories(backend, async ({ budgets, scopes }, { userId }) => {
      const budget = await budgets.create(newBudget(userId, "Groceries"));
      const accountId = crypto.randomUUID();
      const categoryId = crypto.randomUUID();
      // `budget_scopes_uq` is unique on (budgetId, kind, refId), so without
      // this the Drizzle repository raised a unique violation (a 500) while
      // the memory one silently kept both — the two disagreed on the same
      // input.
      const replaced = await scopes.replace(budget.id, [
        { kind: "account", refId: accountId },
        { kind: "category", refId: categoryId },
        { kind: "account", refId: accountId },
      ]);
      expect(replaced.map((row) => `${row.kind}:${row.refId}`)).toEqual([`account:${accountId}`, `category:${categoryId}`]);
      expect(await scopes.listForBudget(budget.id)).toHaveLength(2);

      // Same `refId` under a different kind is a different scope, not a repeat.
      const distinct = await scopes.replace(budget.id, [
        { kind: "account", refId: accountId },
        { kind: "category", refId: accountId },
      ]);
      expect(distinct).toHaveLength(2);
    });
  });
});

describe.each(BACKENDS)("$backend usages repository contract", ({ backend }) => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("orders by occurredAt then id, filters by range, and deletes reporting whether one existed", async () => {
    await runWithRepositories(backend, async ({ budgets, usages }, { userId }) => {
      const budget = await budgets.create(newBudget(userId, "Groceries"));
      await usages.create({ budgetId: budget.id, transactionId: null, amount: "10", occurredAt: "2026-01-15", matchedBy: "manual", note: "later" });
      const earlier = await usages.create({ budgetId: budget.id, transactionId: null, amount: "5", occurredAt: "2026-01-01", matchedBy: "manual", note: "earlier" });
      expect((await usages.listForBudget(budget.id)).map((row) => row.note)).toEqual(["earlier", "later"]);
      expect((await usages.listForBudget(budget.id, { from: "2026-01-10" })).map((row) => row.note)).toEqual(["later"]);
      await expect(usages.delete(budget.id, earlier.id)).resolves.toBe(true);
      await expect(usages.delete(budget.id, earlier.id)).resolves.toBe(false);
    });
  });

  describe("replaceScopeMatched", () => {
    it("inserts new transactions, batch-updates two changed amounts in one call, deletes absent rows, and never touches manual rows", async () => {
      // budget_usages.transaction_id carries a real FK to transactions, so
      // this needs actual rows there rather than arbitrary strings.
      const userId = await seedUser(`${backend} scope-matched user`);
      const db = await testDb();
      await withSystemContext(db, async (tx) => {
        const [account] = await tx.insert(accounts).values({ userId, name: "Checking", type: "checking", origin: "manual" }).returning();
        const expense = (occurredAt: string, amount: string) =>
          tx.insert(transactions).values({ userId, accountId: account!.id, occurredAt: new Date(`${occurredAt}T12:00:00Z`), amount, type: "expense" }).returning();
        const [txChangedA] = await expense("2026-01-06", "-10.00");
        const [txChangedB] = await expense("2026-01-08", "-20.00");
        const [txStale] = await expense("2026-01-05", "-10.00");
        const [txNew] = await expense("2026-01-07", "-30.00");

        const { budgets, usages } = backend === "memory" ? memoryRepositories() : drizzleRepositories(tx);
        const budget = await budgets.create(newBudget(userId, "Groceries"));
        await usages.create({ budgetId: budget.id, transactionId: null, amount: "999", occurredAt: "2026-01-01", matchedBy: "manual", note: "manual entry" });
        const changedA = await usages.create({ budgetId: budget.id, transactionId: txChangedA!.id, amount: "10.00", occurredAt: "2026-01-06", matchedBy: "scope", note: null });
        const changedB = await usages.create({ budgetId: budget.id, transactionId: txChangedB!.id, amount: "20.00", occurredAt: "2026-01-08", matchedBy: "scope", note: null });
        await usages.create({ budgetId: budget.id, transactionId: txStale!.id, amount: "10.00", occurredAt: "2026-01-05", matchedBy: "scope", note: null });

        // A single call changes two existing rows' amounts at once — this is
        // what distinguishes a real batch from a loop that happens to work.
        const result = await usages.replaceScopeMatched(budget.id, [
          { transactionId: txChangedA!.id, amount: "15.00", occurredAt: "2026-01-06" },
          { transactionId: txChangedB!.id, amount: "25.00", occurredAt: "2026-01-08" },
          { transactionId: txNew!.id, amount: "30.00", occurredAt: "2026-01-07" },
        ]);
        expect(result).toEqual({ inserted: 1, updated: 2, deleted: 1 });

        const rows = await usages.listForBudget(budget.id);
        expect(rows.map((row) => row.transactionId).sort()).toEqual([null, txChangedA!.id, txChangedB!.id, txNew!.id].sort());
        expect(rows.find((row) => row.note === "manual entry")).toMatchObject({ amount: "999.00" });
        expect(rows.find((row) => row.transactionId === txChangedA!.id)).toMatchObject({ id: changedA.id, amount: "15.00" });
        expect(rows.find((row) => row.transactionId === txChangedB!.id)).toMatchObject({ id: changedB.id, amount: "25.00" });
        expect(rows.find((row) => row.transactionId === txStale!.id)).toBeUndefined();

        // A second call with the exact same set is a no-op.
        const noop = await usages.replaceScopeMatched(budget.id, [
          { transactionId: txChangedA!.id, amount: "15.00", occurredAt: "2026-01-06" },
          { transactionId: txChangedB!.id, amount: "25.00", occurredAt: "2026-01-08" },
          { transactionId: txNew!.id, amount: "30.00", occurredAt: "2026-01-07" },
        ]);
        expect(noop).toEqual({ inserted: 0, updated: 0, deleted: 0 });
      });
    });
  });
});

describe.each(BACKENDS)("$backend events repository contract", ({ backend }) => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("orders by createdAt desc and respects a limit", async () => {
    await runWithRepositories(backend, async ({ budgets, events }, { userId }) => {
      const budget = await budgets.create(newBudget(userId, "Groceries"));
      await events.add({ budgetId: budget.id, kind: "created", detail: {}, actorUserId: null });
      await events.add({ budgetId: budget.id, kind: "updated", detail: { field: "name" }, actorUserId: null });
      await events.add({ budgetId: budget.id, kind: "archived", detail: {}, actorUserId: null });
      const kinds = (await events.listForBudget(budget.id)).map((row) => row.kind);
      expect(kinds).toEqual(["archived", "updated", "created"]);
      expect((await events.listForBudget(budget.id, 2)).map((row) => row.kind)).toEqual(["archived", "updated"]);
    });
  });
});

describe("Drizzle transactions-scope-source", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("filters type='expense' regardless of state, aggregates label ids, and renders occurredAt in Europe/Rome", async () => {
    const userId = await seedUser("Scope");
    const db = await testDb();
    await withSystemContext(db, async (tx) => {
      const [account] = await tx.insert(accounts).values({ userId, name: "Checking", type: "checking", origin: "manual" }).returning();
      const [category] = await tx.insert(transactionCategories).values({ userId, name: "Food" }).returning();
      const [labelA] = await tx.insert(transactionLabels).values({ userId, name: "grocery" }).returning();
      const [labelB] = await tx.insert(transactionLabels).values({ userId, name: "essential" }).returning();

      const [pendingExpense] = await tx.insert(transactions).values({
        userId, accountId: account!.id, occurredAt: new Date("2026-09-02T10:00:00Z"), amount: "-42.50",
        type: "expense", state: "pending", categoryId: category!.id,
      }).returning();
      const [clearedExpense] = await tx.insert(transactions).values({
        userId, accountId: account!.id, occurredAt: new Date("2026-09-03T10:00:00Z"), amount: "-12.00",
        type: "expense", state: "cleared", categoryId: null,
      }).returning();
      await tx.insert(transactions).values({
        userId, accountId: account!.id, occurredAt: new Date("2026-09-02T10:00:00Z"), amount: "1500.00", type: "income", state: "cleared",
      });
      await tx.insert(transactions).values({
        userId, accountId: account!.id, occurredAt: new Date("2026-09-02T10:00:00Z"), amount: "-100.00", type: "transfer", state: "cleared",
      });
      // Outside the requested range.
      await tx.insert(transactions).values({
        userId, accountId: account!.id, occurredAt: new Date("2026-08-01T10:00:00Z"), amount: "-5.00", type: "expense", state: "cleared",
      });
      await tx.insert(transactionLabelLinks).values([
        { transactionId: pendingExpense!.id, labelId: labelA!.id },
        { transactionId: pendingExpense!.id, labelId: labelB!.id },
      ]);

      const source = drizzleTransactionsScopeSource(tx);
      const rows = await source.listExpenses(userId, { from: "2026-09-01", to: "2026-09-05", currency: "EUR" });
      expect(rows.map((row) => row.id).sort()).toEqual([pendingExpense!.id, clearedExpense!.id].sort());

      const pending = rows.find((row) => row.id === pendingExpense!.id)!;
      expect(pending.type).toBe("expense");
      expect(pending.occurredAt).toBe("2026-09-02");
      expect(pending.categoryId).toBe(category!.id);
      expect([...pending.labelIds].sort()).toEqual([labelA!.id, labelB!.id].sort());

      const cleared = rows.find((row) => row.id === clearedExpense!.id)!;
      expect(cleared.categoryId).toBeNull();
      expect(cleared.labelIds).toEqual([]);
    });
  });

  it("includes an expense in the first Rome hours of `from`, whose UTC instant falls on the previous day", async () => {
    const userId = await seedUser("Rome boundary");
    const db = await testDb();
    await withSystemContext(db, async (tx) => {
      const [account] = await tx.insert(accounts).values({ userId, name: "Checking", type: "checking", origin: "manual" }).returning();
      // 00:30 Rome on 2026-02-01 — the budget's own start date — is 23:30Z on 2026-01-31.
      const [earlyRome] = await tx.insert(transactions).values({
        userId, accountId: account!.id, occurredAt: new Date("2026-01-31T23:30:00Z"), amount: "-9.99",
        type: "expense", state: "cleared",
      }).returning();
      // 23:30 Rome on 2026-02-28 is 22:30Z the same day; the last civil day must be included whole.
      const [lateRome] = await tx.insert(transactions).values({
        userId, accountId: account!.id, occurredAt: new Date("2026-02-28T22:30:00Z"), amount: "-1.00",
        type: "expense", state: "cleared",
      }).returning();
      // 23:30 Rome on 2026-01-31 is 22:30Z — genuinely before the range.
      await tx.insert(transactions).values({
        userId, accountId: account!.id, occurredAt: new Date("2026-01-31T22:30:00Z"), amount: "-2.00",
        type: "expense", state: "cleared",
      });
      // 00:30 Rome on 2026-03-01 is 23:30Z on 2026-02-28 — genuinely after the range.
      await tx.insert(transactions).values({
        userId, accountId: account!.id, occurredAt: new Date("2026-02-28T23:30:00Z"), amount: "-3.00",
        type: "expense", state: "cleared",
      });

      const source = drizzleTransactionsScopeSource(tx);
      const rows = await source.listExpenses(userId, { from: "2026-02-01", to: "2026-02-28", currency: "EUR" });
      expect(rows.map((row) => row.id).sort()).toEqual([earlyRome!.id, lateRome!.id].sort());
      expect(rows.find((row) => row.id === earlyRome!.id)!.occurredAt).toBe("2026-02-01");
      expect(rows.find((row) => row.id === lateRome!.id)!.occurredAt).toBe("2026-02-28");
    });
  });

  it("returns only transactions in the requested currency", async () => {
    const userId = await seedUser("Currency");
    const db = await testDb();
    await withSystemContext(db, async (tx) => {
      const [account] = await tx.insert(accounts).values({ userId, name: "Checking", type: "checking", origin: "manual" }).returning();
      const [eur] = await tx.insert(transactions).values({
        userId, accountId: account!.id, occurredAt: new Date("2026-09-02T10:00:00Z"), amount: "-42.50",
        type: "expense", state: "cleared", currency: "EUR",
      }).returning();
      // `transactions.currency` is unconstrained and provider sync copies what
      // the provider sends. Counted into a EUR budget at face value, this row
      // would silently mix currencies into `used`.
      const [usd] = await tx.insert(transactions).values({
        userId, accountId: account!.id, occurredAt: new Date("2026-09-02T10:00:00Z"), amount: "-99.00",
        type: "expense", state: "cleared", currency: "USD",
      }).returning();

      const source = drizzleTransactionsScopeSource(tx);
      expect((await source.listExpenses(userId, { from: "2026-09-01", to: "2026-09-05", currency: "EUR" })).map((row) => row.id)).toEqual([eur!.id]);
      expect((await source.listExpenses(userId, { from: "2026-09-01", to: "2026-09-05", currency: "USD" })).map((row) => row.id)).toEqual([usd!.id]);
    });
  });
});

describe("Drizzle source-balance-source", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("account resolves its latest balance; an unknown or another user's account resolves null (never a fabricated 0.00)", async () => {
    const userA = await seedUser("A");
    const userB = await seedUser("B");
    const db = await testDb();
    await withSystemContext(db, async (tx) => {
      const [account] = await tx.insert(accounts).values({ userId: userA, name: "Checking", type: "checking", origin: "manual" }).returning();
      await tx.insert(accountBalances).values([
        { accountId: account!.id, asOf: "2026-08-31", balance: "900.00", source: "manual" },
        { accountId: account!.id, asOf: "2026-09-01", balance: "1000.00", source: "manual" },
      ]);
      const source = drizzleSourceBalanceSource(tx);
      await expect(source.latestBalance(userA, { kind: "account", id: account!.id })).resolves.toBe("1000.00");
      await expect(source.latestBalance(userB, { kind: "account", id: account!.id })).resolves.toBeNull();
      await expect(source.latestBalance(userA, { kind: "account", id: crypto.randomUUID() })).resolves.toBeNull();
    });
  });

  it("fund resolves via its linked account, and an unlinked fund resolves null", async () => {
    const userA = await seedUser("A");
    const db = await testDb();
    await withSystemContext(db, async (tx) => {
      const [account] = await tx.insert(accounts).values({ userId: userA, name: "Pension account", type: "pension_fund", origin: "manual" }).returning();
      await tx.insert(accountBalances).values({ accountId: account!.id, asOf: "2026-09-01", balance: "2500.00", source: "manual" });
      const [linkedFund] = await tx.insert(funds).values({ userId: userA, slug: "linked", name: "Linked", kind: "pension", accountId: account!.id }).returning();
      const [unlinkedFund] = await tx.insert(funds).values({ userId: userA, slug: "unlinked", name: "Unlinked", kind: "pension", accountId: null }).returning();

      const source = drizzleSourceBalanceSource(tx);
      await expect(source.latestBalance(userA, { kind: "fund", id: linkedFund!.id })).resolves.toBe("2500.00");
      await expect(source.latestBalance(userA, { kind: "fund", id: unlinkedFund!.id })).resolves.toBeNull();
    });
  });
});

describe("Drizzle ownership-check", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("accountExists and fundExists are scoped to the caller's own userId", async () => {
    const userA = await seedUser("A");
    const userB = await seedUser("B");
    const db = await testDb();
    await withSystemContext(db, async (tx) => {
      const [account] = await tx.insert(accounts).values({ userId: userA, name: "Checking", type: "checking", origin: "manual" }).returning();
      const [fund] = await tx.insert(funds).values({ userId: userA, slug: "pension", name: "Pension", kind: "pension" }).returning();
      const check = drizzleOwnershipCheck(tx);
      await expect(check.accountExists(userA, account!.id)).resolves.toBe(true);
      await expect(check.accountExists(userB, account!.id)).resolves.toBe(false);
      await expect(check.fundExists(userA, fund!.id)).resolves.toBe(true);
      await expect(check.fundExists(userB, fund!.id)).resolves.toBe(false);
      await expect(check.accountExists(userA, crypto.randomUUID())).resolves.toBe(false);
    });
  });
});
