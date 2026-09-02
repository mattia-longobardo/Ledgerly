import { describe, expect, it } from "vitest";
import { PermissionDeniedError } from "@/platform/auth/principal";
import { testPrincipal } from "@/test/principal";
import {
  MemoryAccountsRepository,
  MemoryClock,
  MemoryProviderLinksRepository,
} from "../infrastructure/memory-repositories";
import type { NewAccount } from "./ports";
import { netWorthSeries } from "./net-worth-series";

const NOW = new Date("2026-09-02T12:00:00Z");

function harness() {
  const deps = {
    accounts: new MemoryAccountsRepository(),
    links: new MemoryProviderLinksRepository(),
    clock: new MemoryClock(NOW),
    audit: async () => {},
  };
  return deps;
}

function newAccount(overrides: Partial<NewAccount> & { name: string }): NewAccount {
  return {
    userId: testPrincipal().userId,
    groupId: null,
    type: "checking",
    currency: "EUR",
    origin: "manual",
    provider: null,
    status: "active",
    includeInNetWorth: true,
    notes: null,
    sortOrder: 0,
    ...overrides,
  };
}

describe("netWorthSeries", () => {
  it("totals only the accounts that count, and reports staleness from the synced ones", async () => {
    const deps = harness();
    const p = testPrincipal();

    const excluded = await deps.accounts.create(
      newAccount({ name: "Shared pot", includeInNetWorth: false, sortOrder: 0 }),
    );
    const unavailable = await deps.accounts.create(
      newAccount({ name: "ING", origin: "synced", provider: "wallet", status: "unavailable", sortOrder: 1 }),
    );
    const manual = await deps.accounts.create(newAccount({ name: "Cash", type: "cash", sortOrder: 2 }));

    await deps.accounts.recordBalances([
      // Newest capture of the lot, but excluded from net worth: it must not
      // reach the total, and it must not set `asOf`.
      {
        accountId: excluded.id,
        asOf: "2026-09-01",
        balance: "1000.00",
        available: null,
        source: "manual",
        capturedAt: new Date("2026-09-02T11:00:00Z"),
      },
      // Synced and three days old: past the 36 h staleness threshold.
      {
        accountId: unavailable.id,
        asOf: "2026-08-30",
        balance: "200.00",
        available: null,
        source: "provider",
        capturedAt: new Date("2026-08-30T12:00:00Z"),
      },
      {
        accountId: manual.id,
        asOf: "2026-09-01",
        balance: "50.25",
        available: null,
        source: "manual",
        capturedAt: new Date("2026-09-01T09:00:00Z"),
      },
    ]);

    const result = await netWorthSeries(deps)(p);

    expect(result.months).toHaveLength(13);
    expect(result.months.at(-1)).toBe("2026-09-01");
    expect(result.perAccount.map((r) => r.account.id)).toEqual([unavailable.id, manual.id]);
    // 200.00 carried forward from August + 50.25 recorded in September.
    expect(result.total.at(-1)).toEqual({ month: "2026-09-01", value: 250.25 });
    expect(result.unavailableCount).toBe(1);
    expect(result.stale).toBe(true);
    expect(result.asOf).toEqual(new Date("2026-09-01T09:00:00Z"));
  });

  it("reports nothing rather than zero when there is no account to total", async () => {
    const deps = harness();
    const result = await netWorthSeries(deps)(testPrincipal());
    expect(result.perAccount).toEqual([]);
    expect(result.total.at(-1)?.value).toBeNull();
    expect(result.asOf).toBeNull();
    expect(result.stale).toBe(false);
    expect(result.unavailableCount).toBe(0);
  });

  it("leaves archived accounts out of the total", async () => {
    const deps = harness();
    const archived = await deps.accounts.create(newAccount({ name: "Old", status: "archived" }));
    await deps.accounts.recordBalances([
      {
        accountId: archived.id,
        asOf: "2026-09-01",
        balance: "10.00",
        available: null,
        source: "manual",
        capturedAt: NOW,
      },
    ]);
    const result = await netWorthSeries(deps)(testPrincipal());
    expect(result.perAccount).toEqual([]);
    expect(result.total.at(-1)?.value).toBeNull();
  });

  it("requires the read permission", async () => {
    const deps = harness();
    await expect(netWorthSeries(deps)(testPrincipal({ roles: [] }))).rejects.toThrow(PermissionDeniedError);
  });
});
