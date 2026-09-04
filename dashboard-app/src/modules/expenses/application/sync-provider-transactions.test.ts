import { describe, expect, it } from "vitest";
import { MemoryProviderLinksRepository } from "@/modules/accounts/infrastructure/memory-repositories";
import {
  MemoryCategoriesRepository,
  MemoryLabelsRepository,
  MemoryRecurringPatternsRepository,
  MemoryTransactionsRepository,
} from "../infrastructure/memory-repositories";
import { syncProviderTransactions } from "./sync-provider-transactions";
import type { ProviderCategory, ProviderTransaction } from "./ports";

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

    const second = await run("user-1", null);
    expect(second.transactionsCreated).toBe(0);
    const all = await deps.transactions.listAll("user-1");
    expect(all).toHaveLength(1);
    expect(all[0]!.categoryId).not.toBeNull();
  });

  it("pairs two legs of a transfer sharing a counter-record id", async () => {
    const { deps } = harness();
    await deps.links.upsertSeen("user-1", { provider: "wallet", entityType: "account", entityId: "local-acc-1", externalId: "wallet-acc-1", metadata: {} }, new Date());
    await deps.links.upsertSeen("user-1", { provider: "wallet", entityType: "account", entityId: "local-acc-2", externalId: "wallet-acc-2", metadata: {} }, new Date());
    const legA = record({ externalId: "wr-a", accountExternalId: "wallet-acc-1", amount: "-50.00", type: "transfer", categoryExternalId: null, labelExternalIds: [], externalTransferRef: "wr-b" });
    const legB = record({ externalId: "wr-b", accountExternalId: "wallet-acc-2", amount: "50.00", type: "transfer", categoryExternalId: null, labelExternalIds: [], externalTransferRef: "wr-a" });
    const source = { provider: "wallet", fetchTransactions: async () => [legA, legB], fetchCategories: async () => [] };
    await syncProviderTransactions({ ...deps, source })("user-1", null);
    const all = await deps.transactions.listAll("user-1");
    expect(all).toHaveLength(2);
    expect(all[0]!.transferGroupId).not.toBeNull();
    expect(all[0]!.transferGroupId).toBe(all[1]!.transferGroupId);
  });
});
