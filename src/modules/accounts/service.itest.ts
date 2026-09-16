import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Ctx } from "@/platform/context";
import { addDays, today } from "@/platform/dates";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { createTestUser } from "../../../test/users";
import { accountsView, listBalanceEntries, listSnapshotRuns } from "./queries";
import type { RemoteAccount } from "./rules";
import {
  AccountError,
  applyProviderAccounts,
  createAccount,
  deleteBalanceEntry,
  removeAccount,
  runSnapshot,
  saveBalanceEntry,
  snapshotMonthFor,
  updateAccountSettings,
} from "./service";

function contextFor(userId: string): Ctx {
  return {
    userId,
    role: "user",
    locale: "en",
    timeZone: "Europe/Rome",
    numberFormat: "it-IT",
  };
}

async function newContext(): Promise<Ctx> {
  return contextFor((await createTestUser()).id);
}

const CHECKING = {
  name: "ING Conto Arancio",
  type: "checking",
  currency: "EUR",
  color: null,
  reference: "",
  purpose: "",
  openedOn: null,
  notes: "",
};

const SETTINGS = {
  ...CHECKING,
  inNetWorth: true,
  inSnapshot: true,
  countsAsLiquid: true,
  lowBalanceCents: null,
  staleAfterHours: 36,
  reminder: "never",
  betweenEntries: "hold",
};

let ctx: Ctx;

beforeEach(async () => {
  await resetDatabase();
  ctx = await newContext();
});

afterAll(closeDatabase);

describe("createAccount", () => {
  it("stores the account and its opening balance together", async () => {
    const account = await createAccount(ctx, {
      ...CHECKING,
      openingBalance: { on: "2026-01-31", cents: 482_055n },
    });
    expect(account.origin).toBe("manual");
    expect(account.state).toBe("active");
    expect(account.currency).toBe("EUR");

    const entries = await listBalanceEntries(ctx, account.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ on: "2026-01-31", balanceCents: 482_055n, source: "manual" });
  });

  it("creates an account with no balance at all", async () => {
    const account = await createAccount(ctx, { ...CHECKING, openingBalance: null });
    expect(await listBalanceEntries(ctx, account.id)).toEqual([]);
  });

  it("refuses an opening balance dated in the future, writing nothing", async () => {
    const future = addDays(today(ctx.timeZone), 3);
    await expect(
      createAccount(ctx, { ...CHECKING, openingBalance: { on: future, cents: 1n } }),
    ).rejects.toThrow(AccountError);
    expect((await accountsView(ctx)).rows).toEqual([]);
  });

  it("gives each new account the next place in the user's order", async () => {
    const first = await createAccount(ctx, { ...CHECKING, openingBalance: null });
    const second = await createAccount(ctx, { ...CHECKING, name: "Revolut", openingBalance: null });
    expect(second.sortOrder).toBe(first.sortOrder + 1);
  });
});

describe("balance entries", () => {
  it("replaces the manual balance of a day rather than adding a second one", async () => {
    const account = await createAccount(ctx, { ...CHECKING, openingBalance: null });
    await saveBalanceEntry(ctx, account.id, { on: "2026-02-10", cents: 100_00n, note: "first" });
    await saveBalanceEntry(ctx, account.id, { on: "2026-02-10", cents: 150_00n, note: "corrected" });

    const entries = await listBalanceEntries(ctx, account.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ balanceCents: 150_00n, note: "corrected" });
  });

  it("refuses a balance dated in the future", async () => {
    const account = await createAccount(ctx, { ...CHECKING, openingBalance: null });
    // Tomorrow in the user's own zone, not in UTC: `toISOString()` is forbidden for a civil date
    // (spec §4.3) and between Rome midnight and UTC midnight it names a day that is already today,
    // so the service rightly accepts it and this test used to fail for two hours a night.
    const future = addDays(today(ctx.timeZone), 1);
    await expect(saveBalanceEntry(ctx, account.id, { on: future, cents: 1n, note: "" })).rejects.toThrow(
      AccountError,
    );
  });

  it("deletes a manual entry and leaves a snapshot's own entry alone", async () => {
    const account = await createAccount(ctx, {
      ...CHECKING,
      openingBalance: { on: "2026-01-15", cents: 100_00n },
    });
    await runSnapshot(ctx, "2026-01-01");
    const entries = await listBalanceEntries(ctx, account.id);
    const system = entries.find((entry) => entry.source === "system");
    const manual = entries.find((entry) => entry.source === "manual");
    expect(system).toBeDefined();

    await deleteBalanceEntry(ctx, system!.id);
    await deleteBalanceEntry(ctx, manual!.id);
    const left = await listBalanceEntries(ctx, account.id);
    expect(left.map((entry) => entry.source)).toEqual(["system"]);
  });

  it("refuses to touch another user's balance", async () => {
    const account = await createAccount(ctx, {
      ...CHECKING,
      openingBalance: { on: "2026-01-15", cents: 100_00n },
    });
    const [entry] = await listBalanceEntries(ctx, account.id);
    const other = await newContext();

    await deleteBalanceEntry(other, entry.id);
    expect(await listBalanceEntries(ctx, account.id)).toHaveLength(1);
    await expect(
      saveBalanceEntry(other, account.id, { on: "2026-01-20", cents: 1n, note: "" }),
    ).rejects.toThrow(AccountError);
  });
});

describe("accountsView", () => {
  it("holds the last balance forward and leaves the months before it unknown", async () => {
    const account = await createAccount(ctx, {
      ...CHECKING,
      openingBalance: { on: "2026-02-10", cents: 200_00n },
    });
    const now = new Date("2026-04-15T10:00:00Z");
    const view = await accountsView(ctx, { months: 4, now });

    expect(view.months).toEqual(["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01"]);
    const row = view.rows.find((one) => one.account.id === account.id);
    expect(row?.series).toEqual([null, 200_00n, 200_00n, 200_00n]);
    expect(row?.balance).toBe(200_00n);
    expect(view.total).toBe(200_00n);
  });

  it("marks a total that is missing an account, and is null when every account is", async () => {
    await createAccount(ctx, { ...CHECKING, openingBalance: { on: "2026-02-10", cents: 100n } });
    await createAccount(ctx, { ...CHECKING, name: "Empty", openingBalance: null });
    const view = await accountsView(ctx, { months: 3, now: new Date("2026-03-15T10:00:00Z") });

    expect(view.total).toBe(100n);
    expect(view.totalPartial).toBe(true);
    // January: neither account has a balance yet, so the total is unknown rather than zero.
    expect(view.netWorth[0]).toEqual({ total: null, partial: true });
    expect(view.netWorth[1]).toEqual({ total: 100n, partial: true });
  });

  it("lets a manual correction win over the provider's reading for the same day", async () => {
    const account = await createAccount(ctx, { ...CHECKING, openingBalance: null });
    await applyProviderAccounts(ctx, "wallet", []);
    await saveBalanceEntry(ctx, account.id, { on: "2026-02-10", cents: 999_00n, note: "" });
    const view = await accountsView(ctx, { months: 1, now: new Date("2026-02-15T10:00:00Z") });
    expect(view.rows[0].balance).toBe(999_00n);
  });

  it("leaves an archived account out of the view", async () => {
    const account = await createAccount(ctx, {
      ...CHECKING,
      openingBalance: { on: "2026-02-10", cents: 100n },
    });
    await updateAccountSettings(ctx, account.id, SETTINGS);
    await removeAccount(ctx, account.id);
    const view = await accountsView(ctx, { now: new Date("2026-02-15T10:00:00Z") });
    expect(view.rows).toEqual([]);
  });

  it("keeps one user's accounts out of another's view", async () => {
    await createAccount(ctx, { ...CHECKING, openingBalance: { on: "2026-02-10", cents: 100n } });
    const other = await newContext();
    const view = await accountsView(other, { now: new Date("2026-02-15T10:00:00Z") });
    expect(view.rows).toEqual([]);
    expect(view.total).toBeNull();
  });
});

describe("runSnapshot", () => {
  it("writes a system balance on the last day of the month, copied from the last known one", async () => {
    const account = await createAccount(ctx, {
      ...CHECKING,
      openingBalance: { on: "2026-01-10", cents: 500_00n },
    });
    const outcome = await runSnapshot(ctx, "2026-01-01");

    expect(outcome).toMatchObject({ month: "2026-01-01", written: 1, skipped: 0, total: 500_00n });
    const entries = await listBalanceEntries(ctx, account.id);
    expect(entries.find((entry) => entry.source === "system")).toMatchObject({
      on: "2026-01-31",
      balanceCents: 500_00n,
    });
  });

  it("skips an account that has no balance up to that day", async () => {
    await createAccount(ctx, { ...CHECKING, openingBalance: { on: "2026-03-10", cents: 1n } });
    const outcome = await runSnapshot(ctx, "2026-01-01");
    expect(outcome).toMatchObject({ written: 0, skipped: 1, total: null });
  });

  it("changes nothing when it runs twice", async () => {
    const account = await createAccount(ctx, {
      ...CHECKING,
      openingBalance: { on: "2026-01-10", cents: 500_00n },
    });
    await runSnapshot(ctx, "2026-01-01");
    await runSnapshot(ctx, "2026-01-01");

    expect(await listBalanceEntries(ctx, account.id)).toHaveLength(2);
    expect(await listSnapshotRuns(ctx)).toHaveLength(1);
  });

  it("follows a balance that changed before it is run again", async () => {
    const account = await createAccount(ctx, {
      ...CHECKING,
      openingBalance: { on: "2026-01-10", cents: 500_00n },
    });
    await runSnapshot(ctx, "2026-01-01");
    await saveBalanceEntry(ctx, account.id, { on: "2026-01-20", cents: 700_00n, note: "" });
    const outcome = await runSnapshot(ctx, "2026-01-01");

    expect(outcome.total).toBe(700_00n);
    const entries = await listBalanceEntries(ctx, account.id);
    expect(entries.find((entry) => entry.source === "system")?.balanceCents).toBe(700_00n);
  });

  it("leaves out an account excluded from the snapshot", async () => {
    const account = await createAccount(ctx, {
      ...CHECKING,
      openingBalance: { on: "2026-01-10", cents: 500_00n },
    });
    await updateAccountSettings(ctx, account.id, { ...SETTINGS, inSnapshot: false });
    const outcome = await runSnapshot(ctx, "2026-01-01");
    expect(outcome).toMatchObject({ written: 0, skipped: 0 });
  });

  it("records the run for the snapshot log, warnings and all", async () => {
    await createAccount(ctx, {
      ...CHECKING,
      openingBalance: { on: "2026-01-10", cents: 500_00n },
    });
    await runSnapshot(ctx, "2026-01-01", new Date("2026-02-01T00:05:00Z"));
    const [run] = await listSnapshotRuns(ctx);
    expect(run).toMatchObject({
      month: "2026-01-01",
      state: "success",
      accountsWritten: 1,
      totalCents: 500_00n,
    });
  });

  it("warns about a synced account whose last reading was already stale", async () => {
    const remote: RemoteAccount = {
      provider: "wallet",
      providerAccountId: "r1",
      name: "Revolut",
      type: "checking",
      currency: "EUR",
    };
    await applyProviderAccounts(ctx, "wallet", [remote], new Date("2026-01-05T00:00:00Z"));
    const [row] = (await accountsView(ctx, { now: new Date("2026-01-10T00:00:00Z") })).rows;
    await saveBalanceEntry(ctx, row.account.id, { on: "2026-01-10", cents: 10n, note: "" });

    const outcome = await runSnapshot(ctx, "2026-01-01", new Date("2026-02-01T00:05:00Z"));
    expect(outcome.warnings).toEqual(["Revolut"]);
    const [run] = await listSnapshotRuns(ctx);
    expect(run.state).toBe("warning");
  });

  it("never reaches into another user's accounts", async () => {
    await createAccount(ctx, { ...CHECKING, openingBalance: { on: "2026-01-10", cents: 1n } });
    const other = await newContext();
    const outcome = await runSnapshot(other, "2026-01-01");
    expect(outcome).toMatchObject({ written: 0, skipped: 0, total: null });
  });
});

describe("snapshotMonthFor", () => {
  it("covers the month that has just ended", () => {
    expect(snapshotMonthFor("2026-02-01")).toBe("2026-01-01");
    expect(snapshotMonthFor("2026-01-01")).toBe("2025-12-01");
  });
});

describe("updateAccountSettings", () => {
  it("saves what a person owns and remembers that the name was chosen here", async () => {
    const account = await createAccount(ctx, { ...CHECKING, openingBalance: null });
    const saved = await updateAccountSettings(ctx, account.id, {
      ...SETTINGS,
      name: "My current account",
      purpose: "Salary",
      lowBalanceCents: 50_000n,
      betweenEntries: "interpolate",
    });
    expect(saved).toMatchObject({
      name: "My current account",
      purpose: "Salary",
      lowBalanceCents: 50_000n,
      betweenEntries: "interpolate",
      renamedLocally: true,
    });
  });

  it("keeps a synced account's type and currency whatever is submitted", async () => {
    const remote: RemoteAccount = {
      provider: "wallet",
      providerAccountId: "r1",
      name: "Fideuram",
      type: "investment",
      currency: "EUR",
    };
    await applyProviderAccounts(ctx, "wallet", [remote]);
    const [row] = (await accountsView(ctx)).rows;

    const saved = await updateAccountSettings(ctx, row.account.id, {
      ...SETTINGS,
      name: "Fideuram",
      type: "cash",
      currency: "USD",
    });
    expect(saved).toMatchObject({ type: "investment", currency: "EUR" });
  });

  it("refuses another user's account", async () => {
    const account = await createAccount(ctx, { ...CHECKING, openingBalance: null });
    const other = await newContext();
    await expect(updateAccountSettings(other, account.id, SETTINGS)).rejects.toThrow(AccountError);
  });
});

describe("removeAccount", () => {
  it("deletes a manual account and its balances", async () => {
    const account = await createAccount(ctx, {
      ...CHECKING,
      openingBalance: { on: "2026-01-10", cents: 1n },
    });
    expect(await removeAccount(ctx, account.id)).toBe("deleted");
    expect((await accountsView(ctx)).rows).toEqual([]);
    expect(await listBalanceEntries(ctx, account.id)).toEqual([]);
  });

  it("archives a synced account instead of deleting it", async () => {
    const remote: RemoteAccount = {
      provider: "wallet",
      providerAccountId: "r1",
      name: "Revolut",
      type: "checking",
      currency: "EUR",
    };
    await applyProviderAccounts(ctx, "wallet", [remote]);
    const [row] = (await accountsView(ctx)).rows;
    expect(await removeAccount(ctx, row.account.id)).toBe("archived");

    const archived = (await accountsView(ctx)).rows;
    expect(archived).toEqual([]);
  });
});

describe("applyProviderAccounts", () => {
  const remote = (over: Partial<RemoteAccount> = {}): RemoteAccount => ({
    provider: "wallet",
    providerAccountId: "r1",
    name: "Revolut Main",
    type: "checking",
    currency: "EUR",
    ...over,
  });

  it("creates the provider's accounts on the first run", async () => {
    await applyProviderAccounts(ctx, "wallet", [remote()]);
    const [row] = (await accountsView(ctx)).rows;
    expect(row.account).toMatchObject({
      name: "Revolut Main",
      origin: "synced",
      provider: "wallet",
      providerAccountId: "r1",
    });
  });

  it("adopts a matching manual account once, keeping its balances", async () => {
    const manual = await createAccount(ctx, {
      ...CHECKING,
      name: "revolut  main",
      openingBalance: { on: "2026-01-10", cents: 42n },
    });
    await applyProviderAccounts(ctx, "wallet", [remote()]);

    const rows = (await accountsView(ctx)).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].account).toMatchObject({ id: manual.id, origin: "synced", providerAccountId: "r1" });
    expect(await listBalanceEntries(ctx, manual.id)).toHaveLength(1);
  });

  it("follows a provider rename, then stops once the name is chosen here", async () => {
    await applyProviderAccounts(ctx, "wallet", [remote()]);
    await applyProviderAccounts(ctx, "wallet", [remote({ name: "Revolut Personal" })]);
    let [row] = (await accountsView(ctx)).rows;
    expect(row.account.name).toBe("Revolut Personal");

    await updateAccountSettings(ctx, row.account.id, { ...SETTINGS, name: "Spending" });
    await applyProviderAccounts(ctx, "wallet", [remote({ name: "Revolut Business" })]);
    [row] = (await accountsView(ctx)).rows;
    expect(row.account.name).toBe("Spending");
  });

  it("marks an account the provider stopped sending as unavailable, and brings it back", async () => {
    await applyProviderAccounts(ctx, "wallet", [remote()]);
    await applyProviderAccounts(ctx, "wallet", []);
    let [row] = (await accountsView(ctx)).rows;
    expect(row.account.state).toBe("unavailable");

    await applyProviderAccounts(ctx, "wallet", [remote()]);
    [row] = (await accountsView(ctx)).rows;
    expect(row.account.state).toBe("active");
  });

  it("touches only the user it is given", async () => {
    const other = await newContext();
    await applyProviderAccounts(ctx, "wallet", [remote()]);
    expect((await accountsView(other)).rows).toEqual([]);
  });
});
