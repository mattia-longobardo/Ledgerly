import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Ctx } from "@/platform/context";
import { upsertFromProvider } from "@/modules/transactions/service";
import { addDays, today } from "@/platform/dates";
import { WALLET_PROVIDER } from "@/platform/integrations/rules";
import { resolveExternal } from "@/platform/integrations/service";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { createTestUser } from "../../../test/users";
import { accountsView, listBalanceEntries, listSnapshotRuns } from "./queries";
import type { IncomingTransaction } from "@/modules/transactions/rules";
import type { RemoteAccount } from "./rules";
import {
  AccountError,
  applyProviderAccounts,
  createAccount,
  accountDailyBalances,
  dailyBalancesOf,
  deleteBalanceEntry,
  rebuildDerivedBalances,
  removeAccount,
  runSnapshot,
  saveBalanceEntry,
  saveProviderBalance,
  snapshotMonthFor,
  updateAccountSettings,
  updateBalanceEntry,
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

  it("corrects the amount, what was available and the note of a manual balance", async () => {
    const account = await createAccount(ctx, { ...CHECKING, openingBalance: null });
    const entry = await saveBalanceEntry(ctx, account.id, {
      on: "2026-02-10",
      cents: 100_00n,
      note: "first",
    });

    await updateBalanceEntry(ctx, entry.id, {
      on: "2026-02-10",
      cents: 175_50n,
      availableCents: 150_00n,
      note: "corrected",
    });

    const entries = await listBalanceEntries(ctx, account.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: entry.id,
      on: "2026-02-10",
      balanceCents: 175_50n,
      availableCents: 150_00n,
      note: "corrected",
    });
  });

  it("moves a manual balance to another day instead of leaving one on each", async () => {
    const account = await createAccount(ctx, { ...CHECKING, openingBalance: null });
    const entry = await saveBalanceEntry(ctx, account.id, {
      on: "2026-02-10",
      cents: 100_00n,
      note: "wrong day",
    });

    await updateBalanceEntry(ctx, entry.id, { on: "2026-02-20", cents: 100_00n, note: "wrong day" });

    const entries = await listBalanceEntries(ctx, account.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ on: "2026-02-20", balanceCents: 100_00n });
  });

  it("updates the manual balance already standing on the day it is moved to", async () => {
    const account = await createAccount(ctx, { ...CHECKING, openingBalance: null });
    await saveBalanceEntry(ctx, account.id, { on: "2026-02-20", cents: 200_00n, note: "kept day" });
    const moved = await saveBalanceEntry(ctx, account.id, {
      on: "2026-02-10",
      cents: 100_00n,
      note: "moved",
    });

    await updateBalanceEntry(ctx, moved.id, { on: "2026-02-20", cents: 100_00n, note: "moved" });

    const entries = await listBalanceEntries(ctx, account.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ on: "2026-02-20", balanceCents: 100_00n, note: "moved" });
  });

  it("refuses to edit a balance that is not a manual one", async () => {
    const account = await createAccount(ctx, {
      ...CHECKING,
      openingBalance: { on: "2026-01-15", cents: 100_00n },
    });
    await runSnapshot(ctx, "2026-01-01");
    const system = (await listBalanceEntries(ctx, account.id)).find((entry) => entry.source === "system");
    expect(system).toBeDefined();

    await expect(
      updateBalanceEntry(ctx, system!.id, { on: "2026-01-31", cents: 1n, note: "" }),
    ).rejects.toThrow(AccountError);
    const left = await listBalanceEntries(ctx, account.id);
    expect(left.find((entry) => entry.source === "system")).toMatchObject({ balanceCents: 100_00n });
  });

  it("refuses to move a balance into the future", async () => {
    const account = await createAccount(ctx, { ...CHECKING, openingBalance: null });
    const entry = await saveBalanceEntry(ctx, account.id, { on: "2026-02-10", cents: 100_00n, note: "" });
    // Tomorrow in the user's own zone, as in the test above (spec §4.3).
    const future = addDays(today(ctx.timeZone), 1);

    await expect(updateBalanceEntry(ctx, entry.id, { on: future, cents: 1n, note: "" })).rejects.toThrow(
      AccountError,
    );
    expect((await listBalanceEntries(ctx, account.id))[0]).toMatchObject({ on: "2026-02-10" });
  });

  it("refuses to edit another user's balance", async () => {
    const account = await createAccount(ctx, {
      ...CHECKING,
      openingBalance: { on: "2026-01-15", cents: 100_00n },
    });
    const [entry] = await listBalanceEntries(ctx, account.id);
    const other = await newContext();

    await expect(
      updateBalanceEntry(other, entry.id, { on: "2026-01-16", cents: 999_00n, note: "theirs" }),
    ).rejects.toThrow(AccountError);
    expect(await listBalanceEntries(ctx, account.id)).toEqual([entry]);
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

  // The movements fall by foreign key; their `provider_links` rows would not (§11.4: `entity_id`
  // is not a real foreign key), and a link nothing can resolve keeps the entity unique key of a
  // row that no longer exists.
  it("forgets the provider links of the movements it takes with it", async () => {
    const account = await createAccount(ctx, { ...CHECKING, openingBalance: null });
    await upsertFromProvider(ctx, account.id, [
      {
        externalId: "w-1",
        counterpartExternalId: null,
        occurredAt: new Date("2026-01-10T09:00:00Z"),
        amountCents: -2_500n,
        currency: "EUR",
        type: "expense",
        state: "cleared",
        payee: "Esselunga",
        note: null,
        categoryExternalId: null,
        categoryName: null,
        categoryGroupExternalId: null,
        categoryGroupName: null,
        labels: [],
      },
    ]);
    const linked = await resolveExternal(ctx, WALLET_PROVIDER, "transaction", ["w-1"]);
    expect(linked.size).toBe(1);

    expect(await removeAccount(ctx, account.id)).toBe("deleted");
    expect(await resolveExternal(ctx, WALLET_PROVIDER, "transaction", ["w-1"])).toEqual(new Map());
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

/** Spec §7.1, F2.5: a synced account's past month ends, rebuilt from its movements. */
describe("rebuildDerivedBalances", () => {
  const spent = (externalId: string, on: string, amountCents: bigint): IncomingTransaction => ({
    externalId,
    counterpartExternalId: null,
    occurredAt: new Date(`${on}T10:00:00Z`),
    amountCents,
    currency: "EUR",
    type: amountCents < 0n ? "expense" : "income",
    state: "cleared",
    payee: "Somebody",
    note: null,
    categoryExternalId: null,
    categoryName: null,
    categoryGroupExternalId: null,
    categoryGroupName: null,
    labels: [],
  });

  /** A Wallet account read once, on 16 September, with a summer of movements behind it. */
  async function aSyncedAccount(): Promise<string> {
    await applyProviderAccounts(ctx, "wallet", [
      { provider: "wallet", providerAccountId: "r1", name: "Revolut", type: "checking", currency: "EUR" },
    ]);
    const [row] = (await accountsView(ctx)).rows;
    await saveProviderBalance(ctx, row.account.id, { on: "2026-09-16", cents: 500_000n });
    await upsertFromProvider(ctx, row.account.id, [
      spent("w-1", "2026-07-03", -10_000n),
      spent("w-2", "2026-08-10", 250_000n),
      spent("w-3", "2026-08-20", -30_000n),
      spent("w-4", "2026-09-02", -20_000n),
    ]);
    return row.account.id;
  }

  const rebuilt = async (accountId: string) =>
    (await listBalanceEntries(ctx, accountId))
      .filter((entry) => entry.source === "derived")
      .map((entry) => [entry.on, entry.balanceCents]);

  it("writes the month ends before the first reading, and nothing new when it runs again", async () => {
    const accountId = await aSyncedAccount();
    expect(await rebuildDerivedBalances(ctx)).toEqual({ written: 3 });
    const first = await rebuilt(accountId);
    expect(first).toEqual([
      ["2026-08-31", 520_000n],
      ["2026-07-31", 300_000n],
      ["2026-06-30", 310_000n],
    ]);

    expect(await rebuildDerivedBalances(ctx)).toEqual({ written: 3 });
    expect(await rebuilt(accountId)).toEqual(first);

    // The chart stands on them, and says so; September is the real reading.
    const view = await accountsView(ctx, {
      months: 4,
      through: "2026-09-01",
      now: new Date("2026-09-17T10:00:00Z"),
    });
    expect(view.netWorth.map((point) => point.total)).toEqual([310_000n, 300_000n, 520_000n, 500_000n]);
    expect(view.netWorthEstimated).toEqual([true, true, true, false]);
  });

  it("never overrides a reading, and moves what it rebuilds when a correction is added or removed", async () => {
    const accountId = await aSyncedAccount();
    await rebuildDerivedBalances(ctx);

    // A correction in August: August has a reading now, and July leans on it instead.
    const correction = await saveBalanceEntry(ctx, accountId, {
      on: "2026-08-15",
      cents: 600_000n,
      note: "",
    });
    expect(await rebuilt(accountId)).toEqual([
      ["2026-07-31", 350_000n],
      ["2026-06-30", 360_000n],
    ]);
    expect(
      (await listBalanceEntries(ctx, accountId)).find((entry) => entry.source === "manual"),
    ).toMatchObject({
      on: "2026-08-15",
      balanceCents: 600_000n,
    });

    await deleteBalanceEntry(ctx, correction.id);
    expect(await rebuilt(accountId)).toHaveLength(3);
  });

  it("gives a synced account's balance day by day, rebuilt before its first reading (F2.5)", async () => {
    const accountId = await aSyncedAccount();
    const days = await accountDailyBalances(ctx, accountId, { from: "2026-09-01", to: "2026-09-03" });
    // 5.000 read on the 16th, 200 spent on the 2nd: 5.200 before it, 5.000 from it on.
    expect(days).toEqual({
      days: ["2026-09-01", "2026-09-02", "2026-09-03"],
      values: [520_000n, 500_000n, 500_000n],
      estimated: [true, true, true],
    });
  });

  it("gives several accounts day by day in one read, each the way it keeps its balance (F2.5)", async () => {
    const synced = await aSyncedAccount();
    const manual = await createAccount(ctx, {
      ...CHECKING,
      name: "Cash box",
      openingBalance: { on: "2026-09-02", cents: 900n },
    });
    const read = await dailyBalancesOf(ctx, [synced, manual.id], { from: "2026-09-01", to: "2026-09-03" });
    expect(read.days).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
    expect(read.series.get(synced)?.values).toEqual([520_000n, 500_000n, 500_000n]);
    expect(read.series.get(manual.id)).toEqual({
      values: [null, 900n, 900n],
      estimated: [false, false, false],
    });
  });

  it("holds a manual account's entries day by day", async () => {
    const account = await createAccount(ctx, {
      ...CHECKING,
      openingBalance: { on: "2026-01-10", cents: 7n },
    });
    const days = await accountDailyBalances(ctx, account.id, { from: "2026-01-09", to: "2026-01-11" });
    expect(days.values).toEqual([null, 7n, 7n]);
  });

  it("leaves a manual account alone: it has no movements to rebuild from", async () => {
    const account = await createAccount(ctx, {
      ...CHECKING,
      openingBalance: { on: "2026-01-10", cents: 1n },
    });
    expect(await rebuildDerivedBalances(ctx)).toEqual({ written: 0 });
    expect((await listBalanceEntries(ctx, account.id)).map((entry) => entry.source)).toEqual(["manual"]);
  });

  it("rebuilds nobody else's accounts", async () => {
    await aSyncedAccount();
    const other = await newContext();
    expect(await rebuildDerivedBalances(other)).toEqual({ written: 0 });
  });
});
