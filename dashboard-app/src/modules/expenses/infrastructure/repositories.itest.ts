import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { accounts, organizations, users } from "@/lib/db/schema";
import { withSystemContext, withUserContext } from "@/platform/db/context";
import { closeDb, resetDb, testDb } from "@/test/db";
import { DrizzleTransactionsRepository } from "./drizzle-transactions-repository";
import { DrizzleCategoriesRepository } from "./drizzle-categories-repository";
import { DrizzleLabelsRepository } from "./drizzle-labels-repository";
import { DrizzleRecurringRepository } from "./drizzle-recurring-repository";

function newTx(userId: string, accountId: string, over: Partial<Parameters<DrizzleTransactionsRepository["create"]>[0]> = {}) {
  return {
    userId,
    accountId,
    occurredAt: new Date("2026-09-01"),
    bookedAt: null,
    amount: "-10.00",
    currency: "EUR",
    type: "expense" as const,
    state: "cleared" as const,
    categoryId: null,
    payee: "A",
    note: null,
    transferGroupId: null,
    source: "manual" as const,
    syncRunId: null,
    ...over,
  };
}

/**
 * `accounts` carries FORCE ROW LEVEL SECURITY, so seeding it on the bare
 * pool connection (no `app.user_id`/`app.role` set) is rejected by its
 * WITH CHECK clause — the same precedent `accounts-rls.itest.ts` and
 * `transactions-rls.itest.ts` follow, seeding through `withSystemContext`.
 */
async function seed() {
  const db = await testDb();
  const [org] = await db.insert(organizations).values({ name: "P" }).returning();
  const [user] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
  const [account] = await withSystemContext(db, (tx) =>
    tx.insert(accounts).values({ userId: user!.id, name: "Cash", type: "cash", origin: "manual" }).returning(),
  );
  return { userId: user!.id, accountId: account!.id };
}

async function seedTwoUsers() {
  const a = await seed();
  const db = await testDb();
  const [org] = await db.insert(organizations).values({ name: "Q" }).returning();
  const [user] = await db.insert(users).values({ organizationId: org!.id, displayName: "B" }).returning();
  const [account] = await withSystemContext(db, (tx) =>
    tx.insert(accounts).values({ userId: user!.id, name: "Cash B", type: "cash", origin: "manual" }).returning(),
  );
  return { a, b: { userId: user!.id, accountId: account!.id } };
}

describe("DrizzleTransactionsRepository", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("lists newest-occurred-first, tied by id descending — same order the memory repository asserts", async () => {
    const { userId, accountId } = await seed();
    const db = await testDb();
    await withUserContext(db, { userId }, async (tx) => {
      const repo = new DrizzleTransactionsRepository(tx);
      await repo.create({ userId, accountId, occurredAt: new Date("2026-09-01"), bookedAt: null, amount: "-10.00", currency: "EUR", type: "expense", state: "cleared", categoryId: null, payee: "A", note: null, transferGroupId: null, source: "manual", syncRunId: null });
      const b = await repo.create({ userId, accountId, occurredAt: new Date("2026-09-03"), bookedAt: null, amount: "-20.00", currency: "EUR", type: "expense", state: "cleared", categoryId: null, payee: "B", note: null, transferGroupId: null, source: "manual", syncRunId: null });
      const page = await repo.list(userId, {});
      expect(page.items[0]!.id).toBe(b.id);
    });
  });

  it("update rejects a stale version, matching the memory repository's contract", async () => {
    const { userId, accountId } = await seed();
    const db = await testDb();
    await withUserContext(db, { userId }, async (tx) => {
      const repo = new DrizzleTransactionsRepository(tx);
      const created = await repo.create({ userId, accountId, occurredAt: new Date(), bookedAt: null, amount: "-5.00", currency: "EUR", type: "expense", state: "cleared", categoryId: null, payee: null, note: null, transferGroupId: null, source: "manual", syncRunId: null });
      const result = await repo.update(userId, created.id, created.version + 1, { note: "x" });
      expect(result).toBe("version_mismatch");
    });
  });

  it("setLabels replaces the full set for a transaction", async () => {
    const { userId, accountId } = await seed();
    const db = await testDb();
    await withUserContext(db, { userId }, async (tx) => {
      const labels = new DrizzleLabelsRepository(tx);
      const l1 = await labels.create({ userId, name: "Recurring", color: null, source: "manual" });
      const l2 = await labels.create({ userId, name: "Work", color: null, source: "manual" });
      const repo = new DrizzleTransactionsRepository(tx);
      const created = await repo.create({ userId, accountId, occurredAt: new Date(), bookedAt: null, amount: "-5.00", currency: "EUR", type: "expense", state: "cleared", categoryId: null, payee: null, note: null, transferGroupId: null, source: "manual", syncRunId: null });
      await repo.setLabels(userId, created.id, [l1.id, l2.id]);
      const map = await repo.labelsFor(userId, [created.id]);
      expect(map.get(created.id)?.sort()).toEqual([l1.id, l2.id].sort());
      await repo.setLabels(userId, created.id, [l1.id]);
      expect((await repo.labelsFor(userId, [created.id])).get(created.id)).toEqual([l1.id]);
    });
  });

  it("filters by userId explicitly — even under a system context that bypasses RLS", async () => {
    const { a, b } = await seedTwoUsers();
    const db = await testDb();
    await withSystemContext(db, async (tx) => {
      const repo = new DrizzleTransactionsRepository(tx);
      await repo.create(newTx(a.userId, a.accountId, { payee: "Mine" }));
      await repo.create(newTx(b.userId, b.accountId, { payee: "Theirs" }));
      const page = await repo.list(a.userId, {});
      expect(page.items.map((t) => t.payee)).toEqual(["Mine"]);
      expect(await repo.listAll(b.userId)).toHaveLength(1);
    });
  });

  it("a cursor naming another user's transaction does not anchor the page, because the anchor lookup filters by userId too", async () => {
    const { a, b } = await seedTwoUsers();
    const db = await testDb();
    await withSystemContext(db, async (tx) => {
      const repo = new DrizzleTransactionsRepository(tx);
      const mine = await repo.create(newTx(a.userId, a.accountId, { occurredAt: new Date("2026-09-01") }));
      const theirs = await repo.create(newTx(b.userId, b.accountId, { occurredAt: new Date("2026-09-05") }));
      // Cursor belongs to user b; listing as user a must ignore it rather than
      // anchor on b's row (which would silently exclude a's own transaction).
      const page = await repo.list(a.userId, { cursor: theirs.id });
      expect(page.items.map((t) => t.id)).toEqual([mine.id]);
    });
  });
});

describe("DrizzleCategoriesRepository", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("finds by exact name only, case-sensitive, matching the memory repository's contract", async () => {
    const { userId } = await seed();
    const db = await testDb();
    await withUserContext(db, { userId }, async (tx) => {
      const repo = new DrizzleCategoriesRepository(tx);
      await repo.create({ userId, name: "Groceries", groupName: null, kind: "expense", color: null, parentId: null, source: "manual", archivedAt: null });
      expect(await repo.findByName(userId, "Groceries")).not.toBeNull();
      expect(await repo.findByName(userId, "groceries")).toBeNull();
    });
  });

  it("lists alphabetically by name and excludes archived unless asked, matching the memory repository's contract", async () => {
    const { userId } = await seed();
    const db = await testDb();
    await withUserContext(db, { userId }, async (tx) => {
      const repo = new DrizzleCategoriesRepository(tx);
      const base = { userId, groupName: null, kind: "expense" as const, color: null, parentId: null, source: "manual" as const };
      await repo.create({ ...base, name: "Zeta", archivedAt: null });
      await repo.create({ ...base, name: "Alpha", archivedAt: new Date() });
      await repo.create({ ...base, name: "Middle", archivedAt: null });

      expect((await repo.list(userId)).map((c) => c.name)).toEqual(["Middle", "Zeta"]);
      expect((await repo.list(userId, { includeArchived: true })).map((c) => c.name)).toEqual([
        "Alpha",
        "Middle",
        "Zeta",
      ]);
    });
  });

  it("filters by userId explicitly — even under a system context that bypasses RLS", async () => {
    const { a, b } = await seedTwoUsers();
    const db = await testDb();
    await withSystemContext(db, async (tx) => {
      const repo = new DrizzleCategoriesRepository(tx);
      await repo.create({ userId: a.userId, name: "Groceries", groupName: null, kind: "expense", color: null, parentId: null, source: "manual", archivedAt: null });
      await repo.create({ userId: b.userId, name: "Rent", groupName: null, kind: "expense", color: null, parentId: null, source: "manual", archivedAt: null });
      expect((await repo.list(a.userId)).map((c) => c.name)).toEqual(["Groceries"]);
      expect(await repo.findByName(a.userId, "Rent")).toBeNull();
    });
  });
});

describe("DrizzleLabelsRepository", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("lists alphabetically by name, matching the memory repository's contract", async () => {
    const { userId } = await seed();
    const db = await testDb();
    await withUserContext(db, { userId }, async (tx) => {
      const repo = new DrizzleLabelsRepository(tx);
      await repo.create({ userId, name: "Work", color: null, source: "manual" });
      await repo.create({ userId, name: "Home", color: null, source: "manual" });
      expect((await repo.list(userId)).map((l) => l.name)).toEqual(["Home", "Work"]);
    });
  });

  it("filters by userId explicitly — even under a system context that bypasses RLS", async () => {
    const { a, b } = await seedTwoUsers();
    const db = await testDb();
    await withSystemContext(db, async (tx) => {
      const repo = new DrizzleLabelsRepository(tx);
      await repo.create({ userId: a.userId, name: "Mine", color: null, source: "manual" });
      await repo.create({ userId: b.userId, name: "Theirs", color: null, source: "manual" });
      expect((await repo.list(a.userId)).map((l) => l.name)).toEqual(["Mine"]);
      expect(await repo.findByName(a.userId, "Theirs")).toBeNull();
    });
  });
});

describe("DrizzleRecurringRepository", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("lists alphabetically by payee, matching the memory repository's contract", async () => {
    const { userId } = await seed();
    const db = await testDb();
    await withUserContext(db, { userId }, async (tx) => {
      const repo = new DrizzleRecurringRepository(tx);
      await repo.replaceAll(userId, [
        { payee: "Zeta", cadence: "monthly", amountLow: "-10.00", amountHigh: "-10.00", currency: "EUR", lastSeenAt: new Date(), nextExpectedAt: new Date(), occurrenceCount: 3 },
        { payee: "Alpha", cadence: "weekly", amountLow: "-5.00", amountHigh: "-5.00", currency: "EUR", lastSeenAt: new Date(), nextExpectedAt: new Date(), occurrenceCount: 3 },
      ]);
      expect((await repo.list(userId)).map((p) => p.payee)).toEqual(["Alpha", "Zeta"]);
    });
  });

  it("replaceAll discards only that user's previous set, matching the memory repository's contract", async () => {
    const { a, b } = await seedTwoUsers();
    const db = await testDb();
    await withSystemContext(db, async (tx) => {
      const repo = new DrizzleRecurringRepository(tx);
      const pattern = { cadence: "monthly" as const, amountLow: "-10.00", amountHigh: "-10.00", currency: "EUR", lastSeenAt: new Date(), nextExpectedAt: new Date(), occurrenceCount: 3 };
      await repo.replaceAll(a.userId, [{ ...pattern, payee: "A-Netflix" }]);
      await repo.replaceAll(b.userId, [{ ...pattern, payee: "B-Netflix" }]);
      await repo.replaceAll(a.userId, []);
      expect(await repo.list(a.userId)).toEqual([]);
      expect((await repo.list(b.userId)).map((p) => p.payee)).toEqual(["B-Netflix"]);
    });
  });
});
