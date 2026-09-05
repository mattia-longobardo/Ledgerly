import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { accounts, organizations, users } from "@/lib/db/schema";
import { withSystemContext, withUserContext } from "@/platform/db/context";
import { closeDb, resetDb, testDb } from "@/test/db";
import { accountDeps } from "@/modules/accounts/infrastructure/deps";
import { expenseDeps } from "../infrastructure/deps";
import { syncProviderTransactions } from "./sync-provider-transactions";
import type { ProviderCategory, ProviderTransaction } from "./ports";

/**
 * `sync-provider-transactions.test.ts` proves the C1 fix (ruling P3-C45)
 * against the in-memory fakes. This suite proves the same behaviour against
 * the real Postgres and its `FORCE ROW LEVEL SECURITY` policies on
 * `transactions` and `provider_links` — the only way to catch a version of
 * the fix that happens to work against the fakes' looser semantics but
 * relies on something the real repositories do not actually guarantee (e.g.
 * `update`'s optimistic-concurrency check, or `byExternal`'s per-user
 * scoping).
 */

function record(overrides: Partial<ProviderTransaction> = {}): ProviderTransaction {
  return {
    externalId: "wr-1",
    accountExternalId: "wallet-acc-1",
    occurredAt: new Date("2026-09-01T08:00:00Z"),
    amount: "-12.50",
    currency: "EUR",
    type: "expense",
    state: "cleared",
    payee: "Shop",
    note: null,
    categoryExternalId: null,
    labelExternalIds: [],
    externalTransferRef: null,
    updatedAt: new Date("2026-09-01T08:00:00Z"),
    ...overrides,
  };
}

async function seedUserWithAccounts(accountNames: readonly string[]) {
  const db = await testDb();
  const [org] = await db.insert(organizations).values({ name: "P" }).returning();
  const [user] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
  const userId = user!.id;
  const accountIds: string[] = [];
  await withSystemContext(db, async (tx) => {
    for (const name of accountNames) {
      const [account] = await tx.insert(accounts).values({ userId, name, type: "cash", origin: "manual" }).returning();
      accountIds.push(account!.id);
    }
  });
  return { userId, accountIds };
}

describe("syncProviderTransactions — cross-run transfer pairing (real database)", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("pairs two transfer legs that arrive in separate runs, more than the lookback window apart (C1 / ruling P3-C45)", async () => {
    const { userId, accountIds } = await seedUserWithAccounts(["Checking", "Savings"]);
    const [checkingId, savingsId] = accountIds;
    const db = await testDb();

    await withUserContext(db, { userId }, async (tx) => {
      const links = accountDeps(tx).links;
      await links.upsertSeen(userId, { provider: "wallet", entityType: "account", entityId: checkingId!, externalId: "wallet-acc-1", metadata: {} }, new Date());
      await links.upsertSeen(userId, { provider: "wallet", entityType: "account", entityId: savingsId!, externalId: "wallet-acc-2", metadata: {} }, new Date());
    });

    const legA = record({
      externalId: "wr-a",
      accountExternalId: "wallet-acc-1",
      amount: "-50.00",
      type: "transfer",
      occurredAt: new Date("2026-08-20T08:00:00Z"),
      externalTransferRef: "wr-b",
    });
    const legB = record({
      externalId: "wr-b",
      accountExternalId: "wallet-acc-2",
      amount: "50.00",
      type: "transfer",
      // 10 days after leg A — more than `RECORDS_LOOKBACK_DAYS` (7) in
      // wallet-provider-adapter.ts, so a real cursor re-fetch would never
      // bring leg A back into the same batch as leg B.
      occurredAt: new Date("2026-08-30T08:00:00Z"),
      externalTransferRef: "wr-a",
    });
    const noCategories: ProviderCategory[] = [];

    // Run 1: only leg A in the provider's window this run.
    await withUserContext(db, { userId }, async (tx) => {
      const deps = { ...expenseDeps(tx), links: accountDeps(tx).links };
      const source = { provider: "wallet", fetchTransactions: async () => [legA], fetchCategories: async () => noCategories };
      await syncProviderTransactions({ ...deps, source })(userId, null);
    });

    const afterRun1 = await withUserContext(db, { userId }, (tx) => expenseDeps(tx).transactions.listAll(userId));
    expect(afterRun1).toHaveLength(1);
    expect(afterRun1[0]!.transferGroupId).toBeNull();

    // Run 2, a separate call (a separate sync run in production): leg A is
    // NOT part of this run's `incoming` batch, yet it must still end up
    // paired with leg B.
    const result2 = await withUserContext(db, { userId }, async (tx) => {
      const deps = { ...expenseDeps(tx), links: accountDeps(tx).links };
      const source = { provider: "wallet", fetchTransactions: async () => [legB], fetchCategories: async () => noCategories };
      return syncProviderTransactions({ ...deps, source })(userId, null);
    });
    expect(result2.transactionsCreated).toBe(1);

    const afterRun2 = await withUserContext(db, { userId }, (tx) => expenseDeps(tx).transactions.listAll(userId));
    expect(afterRun2).toHaveLength(2);
    const groupIds = new Set(afterRun2.map((t) => t.transferGroupId));
    expect(groupIds.size).toBe(1);
    expect([...groupIds][0]).not.toBeNull();
  });
});
