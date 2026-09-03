import { beforeEach, describe, expect, it } from "vitest";
import {
  MemoryAccountsRepository,
  MemoryClock,
} from "@/modules/accounts/infrastructure/memory-repositories";
import type { NewAccount } from "@/modules/accounts/application/ports";
import { closePreviousMonth } from "./monthly-close";

const USER = "00000000-0000-7000-8000-000000000001";

function account(overrides: Partial<NewAccount> = {}): NewAccount {
  return {
    userId: USER,
    groupId: null,
    name: "Checking",
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

describe("closePreviousMonth", () => {
  let accounts: MemoryAccountsRepository;
  let clock: MemoryClock;

  beforeEach(() => {
    accounts = new MemoryAccountsRepository();
    // "Now" is 2026-09-15: the previous Rome month is August, closing on 2026-08-31.
    clock = new MemoryClock(new Date("2026-09-15T10:00:00Z"));
  });

  it("writes the last known balance at or before the close day, dated to the close day", async () => {
    const acc = await accounts.create(account());
    await accounts.recordBalances([
      { accountId: acc.id, asOf: "2026-08-10", balance: "100.00", available: null, source: "manual" },
      { accountId: acc.id, asOf: "2026-08-25", balance: "150.00", available: null, source: "manual" },
      // After the close day: must not be picked.
      { accountId: acc.id, asOf: "2026-09-05", balance: "999.00", available: null, source: "manual" },
    ]);

    const result = await closePreviousMonth({ accounts, clock }, USER);

    expect(result).toEqual({ closed: 1 });
    const history = await accounts.history(USER, [acc.id], "0001-01-01");
    const closing = history.find((p) => p.source === "system");
    expect(closing).toMatchObject({ asOf: "2026-08-31", balance: "150.00", source: "system" });
  });

  it("skips accounts with no balance at all", async () => {
    await accounts.create(account({ name: "No history" }));

    const result = await closePreviousMonth({ accounts, clock }, USER);

    expect(result).toEqual({ closed: 0 });
  });

  it("is idempotent: a second run over the same data changes nothing", async () => {
    const acc = await accounts.create(account());
    await accounts.recordBalances([
      { accountId: acc.id, asOf: "2026-08-25", balance: "150.00", available: null, source: "manual" },
    ]);

    await closePreviousMonth({ accounts, clock }, USER);
    const first = await accounts.history(USER, [acc.id], "0001-01-01");

    const second = await closePreviousMonth({ accounts, clock }, USER);
    const after = await accounts.history(USER, [acc.id], "0001-01-01");

    expect(second).toEqual({ closed: 1 });
    expect(after).toEqual(first);
  });

  it("closes every non-archived account, and leaves an archived one alone", async () => {
    const active = await accounts.create(account({ name: "Active" }));
    const archived = await accounts.create(account({ name: "Archived", status: "archived" }));
    await accounts.recordBalances([
      { accountId: active.id, asOf: "2026-08-01", balance: "10.00", available: null, source: "manual" },
      { accountId: archived.id, asOf: "2026-08-01", balance: "20.00", available: null, source: "manual" },
    ]);

    const result = await closePreviousMonth({ accounts, clock }, USER);

    expect(result).toEqual({ closed: 1 });
    const activeHistory = await accounts.history(USER, [active.id], "0001-01-01");
    const archivedHistory = await accounts.history(USER, [archived.id], "0001-01-01");
    expect(activeHistory.some((p) => p.source === "system")).toBe(true);
    expect(archivedHistory.some((p) => p.source === "system")).toBe(false);
  });
});
