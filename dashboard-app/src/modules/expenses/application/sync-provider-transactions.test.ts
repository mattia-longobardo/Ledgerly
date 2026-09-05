import { describe, expect, it } from "vitest";
import { MemoryProviderLinksRepository } from "@/modules/accounts/infrastructure/memory-repositories";
import {
  MemoryCategoriesRepository,
  MemoryLabelsRepository,
  MemoryRecurringPatternsRepository,
  MemoryTransactionsRepository,
} from "../infrastructure/memory-repositories";
import { syncProviderTransactions } from "./sync-provider-transactions";
import type { ProviderCategory, ProviderTransaction, TransactionsRepository } from "./ports";

function harness() {
  const links = new MemoryProviderLinksRepository();
  const audit: unknown[] = [];
  const deps = {
    transactions: new MemoryTransactionsRepository(),
    categories: new MemoryCategoriesRepository(),
    labels: new MemoryLabelsRepository(),
    recurring: new MemoryRecurringPatternsRepository(),
    links,
    clock: { now: () => new Date("2026-09-05T09:00:00Z") },
    audit: async (e: unknown) => {
      audit.push(e);
    },
  };
  return { deps, audit };
}

const category: ProviderCategory = { externalId: "wc-1", name: "Groceries", groupName: null, kind: "expense" };

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
    categoryExternalId: "wc-1",
    labelExternalIds: ["work"],
    externalTransferRef: null,
    updatedAt: new Date("2026-09-01T08:00:00Z"),
    ...overrides,
  };
}

describe("syncProviderTransactions", () => {
  it("skips a record whose account has not been synced yet", async () => {
    const { deps } = harness();
    const source = { provider: "wallet", fetchTransactions: async () => [record()], fetchCategories: async () => [category] };
    const result = await syncProviderTransactions({ ...deps, source })("user-1", null);
    expect(result.skippedNoAccount).toBe(1);
    expect(await deps.transactions.listAll("user-1")).toHaveLength(0);
  });

  it("creates a category, a label and a transaction on first sync, then is idempotent on a second run", async () => {
    const { deps } = harness();
    await deps.links.upsertSeen(
      "user-1",
      { provider: "wallet", entityType: "account", entityId: "local-acc-1", externalId: "wallet-acc-1", metadata: {} },
      new Date(),
    );
    const source = { provider: "wallet", fetchTransactions: async () => [record()], fetchCategories: async () => [category] };
    const run = syncProviderTransactions({ ...deps, source });

    const first = await run("user-1", null);
    expect(first).toMatchObject({ transactionsCreated: 1, categoriesCreated: 1, labelsCreated: 1, skippedNoAccount: 0 });

    const afterFirst = await deps.transactions.listAll("user-1");
    expect(afterFirst).toHaveLength(1);
    const { version: versionAfterFirst, updatedAt: updatedAtAfterFirst } = afterFirst[0]!;

    const second = await run("user-1", null);
    // The weaker check: nothing new is created.
    expect(second.transactionsCreated).toBe(0);
    // The load-bearing check: nothing is even patched. `getRecords`'s cursor
    // deliberately re-fetches an overlapping window on every run, so a second
    // pass over an unchanged record must be a complete no-op on that row — not
    // merely "no new row" — or `version`/`updatedAt` would churn forever on
    // every re-fetch of the same data.
    expect(second.transactionsUpdated).toBe(0);
    const all = await deps.transactions.listAll("user-1");
    expect(all).toHaveLength(1);
    expect(all[0]!.categoryId).not.toBeNull();
    expect(all[0]!.version).toBe(versionAfterFirst);
    expect(all[0]!.updatedAt).toEqual(updatedAtAfterFirst);
  });

  it("pairs two legs of a transfer sharing a counter-record id, stably across a second run", async () => {
    const { deps } = harness();
    await deps.links.upsertSeen("user-1", { provider: "wallet", entityType: "account", entityId: "local-acc-1", externalId: "wallet-acc-1", metadata: {} }, new Date());
    await deps.links.upsertSeen("user-1", { provider: "wallet", entityType: "account", entityId: "local-acc-2", externalId: "wallet-acc-2", metadata: {} }, new Date());
    const legA = record({ externalId: "wr-a", accountExternalId: "wallet-acc-1", amount: "-50.00", type: "transfer", categoryExternalId: null, labelExternalIds: [], externalTransferRef: "wr-b" });
    const legB = record({ externalId: "wr-b", accountExternalId: "wallet-acc-2", amount: "50.00", type: "transfer", categoryExternalId: null, labelExternalIds: [], externalTransferRef: "wr-a" });
    const source = { provider: "wallet", fetchTransactions: async () => [legA, legB], fetchCategories: async () => [] };
    const run = syncProviderTransactions({ ...deps, source });

    await run("user-1", null);
    const afterFirst = await deps.transactions.listAll("user-1");
    expect(afterFirst).toHaveLength(2);
    expect(afterFirst[0]!.transferGroupId).not.toBeNull();
    expect(afterFirst[0]!.transferGroupId).toBe(afterFirst[1]!.transferGroupId);
    const versionsAfterFirst = new Map(afterFirst.map((t) => [t.id, t.version]));

    const second = await run("user-1", null);
    expect(second.transactionsCreated).toBe(0);
    expect(second.transactionsUpdated).toBe(0);
    const afterSecond = await deps.transactions.listAll("user-1");
    expect(afterSecond).toHaveLength(2);
    // Pairing is stable: same group, and re-pairing an already-paired leg is a
    // no-op — its version does not churn on a second run.
    expect(afterSecond[0]!.transferGroupId).toBe(afterFirst[0]!.transferGroupId);
    expect(afterSecond[1]!.transferGroupId).toBe(afterFirst[1]!.transferGroupId);
    for (const t of afterSecond) {
      expect(t.version).toBe(versionsAfterFirst.get(t.id));
    }
  });

  it("pairs two transfer legs that arrive in separate runs more than the lookback window apart (C1 / ruling P3-C45)", async () => {
    const { deps } = harness();
    await deps.links.upsertSeen("user-1", { provider: "wallet", entityType: "account", entityId: "local-acc-1", externalId: "wallet-acc-1", metadata: {} }, new Date());
    await deps.links.upsertSeen("user-1", { provider: "wallet", entityType: "account", entityId: "local-acc-2", externalId: "wallet-acc-2", metadata: {} }, new Date());

    const legA = record({
      externalId: "wr-a",
      accountExternalId: "wallet-acc-1",
      amount: "-50.00",
      type: "transfer",
      occurredAt: new Date("2026-08-20T08:00:00Z"),
      categoryExternalId: null,
      labelExternalIds: [],
      externalTransferRef: "wr-b",
    });
    const legB = record({
      externalId: "wr-b",
      accountExternalId: "wallet-acc-2",
      amount: "50.00",
      type: "transfer",
      // 10 days after leg A — more than `RECORDS_LOOKBACK_DAYS` (7) in
      // wallet-provider-adapter.ts, so a real cursor re-fetch would never
      // bring leg A back into the same batch as leg B ever again.
      occurredAt: new Date("2026-08-30T08:00:00Z"),
      categoryExternalId: null,
      labelExternalIds: [],
      externalTransferRef: "wr-a",
    });

    // Run 1: only leg A is in the provider's window this run. Nothing in
    // this run's own batch to pair it with, so it must sync unpaired rather
    // than error.
    const run1Source = { provider: "wallet", fetchTransactions: async () => [legA], fetchCategories: async () => [] };
    await syncProviderTransactions({ ...deps, source: run1Source })("user-1", null);
    const afterRun1 = await deps.transactions.listAll("user-1");
    expect(afterRun1).toHaveLength(1);
    expect(afterRun1[0]!.transferGroupId).toBeNull();

    // Run 2, a separate call to the handler (a separate sync run in
    // production): leg A is NOT part of this run's `incoming` batch — proving
    // the fix does not depend on leg A having been re-fetched — yet it must
    // still end up paired with leg B.
    const run2Source = { provider: "wallet", fetchTransactions: async () => [legB], fetchCategories: async () => [] };
    const result2 = await syncProviderTransactions({ ...deps, source: run2Source })("user-1", null);

    expect(result2.transactionsCreated).toBe(1); // leg B only; leg A already existed
    const afterRun2 = await deps.transactions.listAll("user-1");
    expect(afterRun2).toHaveLength(2);
    const groupIds = new Set(afterRun2.map((t) => t.transferGroupId));
    expect(groupIds.size).toBe(1);
    expect([...groupIds][0]).not.toBeNull();
  });

  it("a lost version race while pairing a cross-run leg does not abort the rest of the sync", async () => {
    const { deps } = harness();
    await deps.links.upsertSeen("user-1", { provider: "wallet", entityType: "account", entityId: "local-acc-1", externalId: "wallet-acc-1", metadata: {} }, new Date());
    await deps.links.upsertSeen("user-1", { provider: "wallet", entityType: "account", entityId: "local-acc-2", externalId: "wallet-acc-2", metadata: {} }, new Date());

    const legA = record({
      externalId: "wr-a",
      accountExternalId: "wallet-acc-1",
      amount: "-50.00",
      type: "transfer",
      categoryExternalId: null,
      labelExternalIds: [],
      externalTransferRef: "wr-b",
    });
    await syncProviderTransactions({ ...deps, source: { provider: "wallet", fetchTransactions: async () => [legA], fetchCategories: async () => [] } })("user-1", null);
    const legAId = (await deps.transactions.listAll("user-1"))[0]!.id;

    // Wraps the real fake, forcing exactly the update that would set leg A's
    // `transferGroupId` to lose a version race — as if a user edited leg A
    // at the worst possible moment. This whole handler runs inside one
    // transaction in production; an uncaught throw here would roll back
    // every other row this run already reconciled.
    const racyTransactions: TransactionsRepository = {
      list: deps.transactions.list.bind(deps.transactions),
      get: deps.transactions.get.bind(deps.transactions),
      create: deps.transactions.create.bind(deps.transactions),
      setLabels: deps.transactions.setLabels.bind(deps.transactions),
      labelsFor: deps.transactions.labelsFor.bind(deps.transactions),
      listAll: deps.transactions.listAll.bind(deps.transactions),
      update: async (userId, id, expectedVersion, patch) => {
        if (id === legAId && patch.transferGroupId !== undefined) return "version_mismatch";
        return deps.transactions.update(userId, id, expectedVersion, patch);
      },
    };

    const legB = record({
      externalId: "wr-b",
      accountExternalId: "wallet-acc-2",
      amount: "50.00",
      type: "transfer",
      categoryExternalId: null,
      labelExternalIds: [],
      externalTransferRef: "wr-a",
    });
    const legC = record({ externalId: "wr-c", accountExternalId: "wallet-acc-1", amount: "-5.00" });
    const source = { provider: "wallet", fetchTransactions: async () => [legB, legC], fetchCategories: async () => [category] };

    // Must not throw, and must still process every other record this run.
    const result = await syncProviderTransactions({ ...deps, transactions: racyTransactions, source })("user-1", null);
    expect(result.transactionsCreated).toBe(2); // legB + legC, despite the lost race on leg A's pairing update
  });

  it("does not count a lost version race as an update (C6)", async () => {
    const { deps } = harness();
    await deps.links.upsertSeen("user-1", { provider: "wallet", entityType: "account", entityId: "local-acc-1", externalId: "wallet-acc-1", metadata: {} }, new Date());
    const source = { provider: "wallet", fetchTransactions: async () => [record()], fetchCategories: async () => [category] };
    await syncProviderTransactions({ ...deps, source })("user-1", null);

    // Force every update this run to report a lost version race, exactly
    // like a concurrent user edit landing between this handler's read and
    // its write.
    const racyTransactions: TransactionsRepository = {
      list: deps.transactions.list.bind(deps.transactions),
      get: deps.transactions.get.bind(deps.transactions),
      create: deps.transactions.create.bind(deps.transactions),
      setLabels: deps.transactions.setLabels.bind(deps.transactions),
      labelsFor: deps.transactions.labelsFor.bind(deps.transactions),
      listAll: deps.transactions.listAll.bind(deps.transactions),
      update: async () => "version_mismatch" as const,
    };
    const changed = record({ note: "edited during sync" });
    const source2 = { provider: "wallet", fetchTransactions: async () => [changed], fetchCategories: async () => [category] };

    const result = await syncProviderTransactions({ ...deps, transactions: racyTransactions, source: source2 })("user-1", null);

    // The patch was attempted (note differs) but never landed — it must not
    // be counted as an update.
    expect(result.transactionsUpdated).toBe(0);
  });

  it("treats two incoming records sharing one externalId within the same batch as one transaction, not two", async () => {
    const { deps } = harness();
    await deps.links.upsertSeen("user-1", { provider: "wallet", entityType: "account", entityId: "local-acc-1", externalId: "wallet-acc-1", metadata: {} }, new Date());
    // Same externalId, different note — the second is what should win, since
    // it is processed after the first within the same run.
    const first = record({ note: "first note" });
    const second = record({ note: "second note" });
    const source = { provider: "wallet", fetchTransactions: async () => [first, second], fetchCategories: async () => [category] };

    const result = await syncProviderTransactions({ ...deps, source })("user-1", null);

    expect(result.transactionsCreated).toBe(1);
    expect(result.transactionsUpdated).toBe(1);
    const all = await deps.transactions.listAll("user-1");
    expect(all).toHaveLength(1);
    expect(all[0]!.note).toBe("second note");

    const links = await deps.links.byExternal("user-1", "wallet", "transaction", [first.externalId]);
    expect(links.get(first.externalId)?.entityId).toBe(all[0]!.id);
  });

  it("treats two incoming categories sharing one externalId within the same batch as one category, not two", async () => {
    const { deps } = harness();
    await deps.links.upsertSeen("user-1", { provider: "wallet", entityType: "account", entityId: "local-acc-1", externalId: "wallet-acc-1", metadata: {} }, new Date());
    // Same externalId, different name — a defensive case (Wallet's shapes are
    // unverified), mirroring the transaction-side test above.
    const catA: ProviderCategory = { externalId: "wc-1", name: "Groceries", groupName: null, kind: "expense" };
    const catB: ProviderCategory = { externalId: "wc-1", name: "Groceries (renamed)", groupName: null, kind: "expense" };
    const txn = record({ categoryExternalId: "wc-1" });
    const source = { provider: "wallet", fetchTransactions: async () => [txn], fetchCategories: async () => [catA, catB] };

    const result = await syncProviderTransactions({ ...deps, source })("user-1", null);

    expect(result.categoriesCreated).toBe(1);
    const categories = await deps.categories.list("user-1");
    expect(categories).toHaveLength(1);

    const links = await deps.links.byExternal("user-1", "wallet", "category", [catA.externalId]);
    expect(links.get(catA.externalId)?.entityId).toBe(categories[0]!.id);
    expect(result.transactionsCreated).toBe(1);
    const allTx = await deps.transactions.listAll("user-1");
    expect(allTx[0]!.categoryId).toBe(categories[0]!.id);
  });
});
