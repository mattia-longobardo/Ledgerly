import { describe, expect, it } from "vitest";
import type { AuditInput } from "@/platform/audit/record";
import {
  MemoryAccountsRepository,
  MemoryClock,
  MemoryGroupsRepository,
  MemoryProviderLinksRepository,
} from "../infrastructure/memory-repositories";
import type { AccountsSource, NewAccount, ProviderAccount } from "./ports";
import { assertWalletSyncAllowed, syncProviderAccounts } from "./sync-provider-accounts";
import { PermissionDeniedError } from "@/platform/auth/principal";
import { testPrincipal } from "@/test/principal";

const USER_ID = "00000000-0000-7000-8000-000000000001";

function harness() {
  const audit: AuditInput[] = [];
  const deps = {
    accounts: new MemoryAccountsRepository(),
    links: new MemoryProviderLinksRepository(),
    groups: new MemoryGroupsRepository(),
    clock: new MemoryClock(new Date("2026-09-02T12:00:00Z")),
    audit: async (e: AuditInput) => {
      audit.push(e);
    },
  };
  return { deps, audit };
}

function provided(over: Partial<ProviderAccount> = {}): ProviderAccount {
  return {
    externalId: "w1",
    name: "ING - Salary",
    type: "checking",
    currency: "EUR",
    archived: false,
    balance: "251.00",
    available: null,
    asOf: "2026-09-02",
    updatedAt: null,
    ...over,
  };
}

function manualAccount(over: Partial<NewAccount> = {}): NewAccount {
  return {
    userId: USER_ID,
    groupId: null,
    name: "ING - Salary",
    type: "checking",
    currency: "EUR",
    origin: "manual",
    provider: null,
    status: "active",
    includeInNetWorth: true,
    notes: null,
    sortOrder: 0,
    ...over,
  };
}

describe("syncProviderAccounts", () => {
  it("creates on first sync, updates balances on the next, marks vanished accounts unavailable", async () => {
    const { deps } = harness();
    const seen = [provided()];
    const source = { provider: "wallet", fetchAccounts: async () => [...seen] };

    const r1 = await syncProviderAccounts({ ...deps, source })(USER_ID);
    expect(r1).toMatchObject({ created: 1, updated: 0, adopted: 0, balances: 1, missing: 0 });

    seen[0]!.balance = "300.00";
    const r2 = await syncProviderAccounts({ ...deps, source })(USER_ID);
    expect(r2).toMatchObject({ created: 0, updated: 1, balances: 1 });
    const latest = await deps.accounts.latestBalances(USER_ID);
    expect([...latest.values()][0]).toMatchObject({ balance: "300.00", source: "provider", asOf: "2026-09-02" });

    seen.length = 0;
    const r3 = await syncProviderAccounts({ ...deps, source })(USER_ID);
    expect(r3.missing).toBe(1);
    const [acc] = await deps.accounts.list(USER_ID);
    expect(acc?.status).toBe("unavailable");

    seen.push(provided({ balance: "300.00" }));
    const r4 = await syncProviderAccounts({ ...deps, source })(USER_ID);
    expect(r4).toMatchObject({ created: 0, adopted: 0, updated: 1, missing: 0 });
    expect((await deps.accounts.list(USER_ID))[0]).toMatchObject({ id: acc!.id, status: "active" });
  });

  it("creates the account as synced and owned by the provider", async () => {
    const { deps } = harness();
    const source = { provider: "wallet", fetchAccounts: async () => [provided({ type: "savings" })] };

    await syncProviderAccounts({ ...deps, source })(USER_ID);

    const [acc] = await deps.accounts.list(USER_ID);
    expect(acc).toMatchObject({ name: "ING - Salary", type: "savings", origin: "synced", provider: "wallet" });
    expect(await deps.links.liveFor("account", acc!.id)).toMatchObject({ externalId: "w1" });
  });

  it("adopts an unlinked manual account with the same name", async () => {
    const { deps } = harness();
    const manual = await deps.accounts.create(manualAccount({ name: "  ing - salary " }));
    const source = { provider: "wallet", fetchAccounts: async () => [provided()] };

    const r = await syncProviderAccounts({ ...deps, source })(USER_ID);

    expect(r).toMatchObject({ created: 0, adopted: 1, balances: 1 });
    const all = await deps.accounts.list(USER_ID);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: manual.id, origin: "synced", provider: "wallet" });
    expect(await deps.links.liveFor("account", manual.id)).toMatchObject({ externalId: "w1" });
  });

  it("adopts a manual account only once, then treats it as linked", async () => {
    const { deps } = harness();
    await deps.accounts.create(manualAccount());
    const source = { provider: "wallet", fetchAccounts: async () => [provided()] };

    await syncProviderAccounts({ ...deps, source })(USER_ID);
    const second = await syncProviderAccounts({ ...deps, source })(USER_ID);

    expect(second).toMatchObject({ created: 0, adopted: 0, updated: 1 });
    expect(await deps.accounts.list(USER_ID)).toHaveLength(1);
  });

  it("re-points a link left behind by a deleted account instead of stalling on it", async () => {
    const { deps } = harness();
    const source = { provider: "wallet", fetchAccounts: async () => [provided()] };
    await syncProviderAccounts({ ...deps, source })(USER_ID);
    const [first] = await deps.accounts.list(USER_ID);
    // The account is gone but its link row survives, as a hard delete of an
    // account whose link was flagged missing leaves it.
    expect(await deps.accounts.delete(USER_ID, first!.id)).toBe(true);

    const r = await syncProviderAccounts({ ...deps, source })(USER_ID);

    expect(r).toMatchObject({ created: 1, adopted: 0, updated: 0, balances: 1 });
    const [rebuilt] = await deps.accounts.list(USER_ID);
    expect(rebuilt?.id).not.toBe(first!.id);
    expect(await deps.links.liveFor("account", rebuilt!.id)).toMatchObject({ externalId: "w1" });
    expect(await deps.links.liveFor("account", first!.id)).toBeNull();
  });

  it("follows a provider rename while the local name is untouched", async () => {
    const { deps } = harness();
    const seen = [provided()];
    const source = { provider: "wallet", fetchAccounts: async () => [...seen] };
    await syncProviderAccounts({ ...deps, source })(USER_ID);

    seen[0]!.name = "ING Current";
    await syncProviderAccounts({ ...deps, source })(USER_ID);

    const [acc] = await deps.accounts.list(USER_ID);
    expect(acc?.name).toBe("ING Current");
  });

  it("keeps a user-renamed account name", async () => {
    const { deps } = harness();
    const seen = [provided()];
    const source = { provider: "wallet", fetchAccounts: async () => [...seen] };
    await syncProviderAccounts({ ...deps, source })(USER_ID);
    const [created] = await deps.accounts.list(USER_ID);
    await deps.accounts.update(USER_ID, created!.id, created!.version, { name: "Salary" });

    seen[0]!.name = "ING Current";
    await syncProviderAccounts({ ...deps, source })(USER_ID);

    const [acc] = await deps.accounts.list(USER_ID);
    expect(acc?.name).toBe("Salary");
  });

  it("marks an account archived upstream as unavailable and revives it when it comes back", async () => {
    const { deps } = harness();
    const seen = [provided()];
    const source = { provider: "wallet", fetchAccounts: async () => [...seen] };
    await syncProviderAccounts({ ...deps, source })(USER_ID);

    seen[0]!.archived = true;
    await syncProviderAccounts({ ...deps, source })(USER_ID);
    expect((await deps.accounts.list(USER_ID))[0]?.status).toBe("unavailable");

    seen[0]!.archived = false;
    await syncProviderAccounts({ ...deps, source })(USER_ID);
    expect((await deps.accounts.list(USER_ID))[0]?.status).toBe("active");
  });

  it("leaves an account the user archived locally archived", async () => {
    const { deps } = harness();
    const source = { provider: "wallet", fetchAccounts: async () => [provided()] };
    await syncProviderAccounts({ ...deps, source })(USER_ID);
    const [created] = await deps.accounts.list(USER_ID);
    await deps.accounts.update(USER_ID, created!.id, created!.version, { status: "archived" });

    await syncProviderAccounts({ ...deps, source })(USER_ID);

    const [acc] = await deps.accounts.list(USER_ID, { includeArchived: true });
    expect(acc?.status).toBe("archived");
  });

  it("never touches another user's accounts", async () => {
    const { deps } = harness();
    const other = "00000000-0000-7000-8000-000000000002";
    await deps.accounts.create(manualAccount({ userId: other }));
    const source = { provider: "wallet", fetchAccounts: async () => [provided()] };

    const r = await syncProviderAccounts({ ...deps, source })(USER_ID);

    expect(r).toMatchObject({ created: 1, adopted: 0 });
    expect((await deps.accounts.list(other))[0]).toMatchObject({ origin: "manual", provider: null });
  });

  it("audits one sync event carrying the counts", async () => {
    const { deps, audit } = harness();
    const source = { provider: "wallet", fetchAccounts: async () => [provided()] };

    await syncProviderAccounts({ ...deps, source })(USER_ID);

    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "accounts.sync",
      entityType: "provider_connection",
      entityId: "wallet",
      after: { created: 1, updated: 0, adopted: 0, balances: 1, missing: 0 },
    });
  });

  it("uses pre-fetched accounts and never calls the source", async () => {
    const { deps } = harness();
    let fetches = 0;
    const source: AccountsSource = {
      provider: "wallet",
      fetchAccounts: async () => {
        fetches += 1;
        return [];
      },
    };
    const prefetched: ProviderAccount[] = [
      {
        externalId: "ext-1",
        name: "Prefetched",
        type: "checking",
        currency: "EUR",
        archived: false,
        balance: "10.00",
        available: null,
        asOf: "2026-09-04",
        updatedAt: null,
      },
    ];
    const result = await syncProviderAccounts({ ...deps, source })(USER_ID, prefetched);
    expect(fetches).toBe(0);
    expect(result.created).toBe(1);
  });
});

describe("assertWalletSyncAllowed", () => {
  it("lets the owner through", () => {
    expect(() => assertWalletSyncAllowed(testPrincipal({ roles: ["owner"] }))).not.toThrow();
  });
  it("refuses an admin, who holds the permission but is not the owner", () => {
    expect(() => assertWalletSyncAllowed(testPrincipal({ roles: ["admin"] }))).toThrow(PermissionDeniedError);
  });
  it("refuses a principal without the permission at all", () => {
    expect(() => assertWalletSyncAllowed(testPrincipal({ roles: ["viewer"] }))).toThrow(PermissionDeniedError);
  });
});
