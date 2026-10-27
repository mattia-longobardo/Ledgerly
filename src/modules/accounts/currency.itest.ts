// Display currency (docs/design/investments.md §1.8, §2.3, phase 1b): every account keeps its own
// currency, and every total converts each account at the ECB rate of its day before summing.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { contextFor as jobContextFor } from "@/modules/users/jobs";
import { updatePreferences } from "@/modules/users/service";
import { DEFAULT_PREFERENCES } from "@/modules/users/rules";
import type { Ctx } from "@/platform/context";
import { saveRates } from "@/platform/fx/service";
import { monthlyFigures } from "@/platform/reports/monthly";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { createTestUser } from "../../../test/users";
import { accountsView, listSnapshotRuns } from "./queries";
import { totalSeries } from "./rules";
import { AccountError, createAccount, runSnapshot, saveBalanceEntry, updateAccountSettings } from "./service";

const BASE = {
  color: null,
  reference: "",
  purpose: "",
  openedOn: null,
  notes: "",
};

const SETTINGS = {
  ...BASE,
  inNetWorth: true,
  inSnapshot: true,
  countsAsLiquid: true,
  lowBalanceCents: null,
  staleAfterHours: 36,
  reminder: "never",
  betweenEntries: "hold",
};

/** Sunday 15/03/2026: the window is January, February and March, read at today. */
const NOW = new Date("2026-03-15T10:00:00Z");

function contextFor(userId: string, displayCurrency: Ctx["displayCurrency"] = "EUR"): Ctx {
  return {
    userId,
    role: "user",
    locale: "en",
    timeZone: "Europe/Rome",
    numberFormat: "it-IT",
    displayCurrency,
  };
}

let ctx: Ctx;
let userId: string;

beforeEach(async () => {
  await resetDatabase();
  userId = (await createTestUser()).id;
  ctx = contextFor(userId);
});

afterAll(closeDatabase);

async function account(name: string, type: string, currency: string, entries: [string, bigint][]) {
  const [first, ...rest] = entries;
  const created = await createAccount(ctx, {
    ...BASE,
    name,
    type,
    currency,
    openingBalance: first ? { on: first[0], cents: first[1] } : null,
  });
  for (const [on, cents] of rest) await saveBalanceEntry(ctx, created.id, { on, cents, note: "" });
  return created;
}

/** USD fixings on the Fridays before each month end, and on Friday 13/03 (today is Sunday). */
async function usdRates() {
  await saveRates([
    { on: "2026-01-30", currency: "USD", eurPerUnit: "0.9000000000" },
    { on: "2026-02-27", currency: "USD", eurPerUnit: "0.8000000000" },
    { on: "2026-03-13", currency: "USD", eurPerUnit: "0.8500000000" },
  ]);
}

describe("golden: every account in EUR, display currency EUR", () => {
  async function seed() {
    await account("Conto", "checking", "EUR", [
      ["2026-01-10", 1_000_00n],
      ["2026-02-20", 1_200_50n],
      ["2026-03-05", 900_00n],
    ]);
    await account("Risparmio", "savings", "EUR", [
      ["2026-01-15", 5_000_00n],
      ["2026-03-10", 5_100_00n],
    ]);
    await account("Broker", "investment", "EUR", [["2026-02-01", 3_000_00n]]);
  }

  it("gives the same figures as the plain sum, with no rate stored at all", async () => {
    await seed();
    const view = await accountsView(ctx, { months: 3, now: NOW });

    expect(view.currency).toBe("EUR");
    expect(view.missingRates).toEqual([]);
    // The figures before phase 1b, written out: the net worth is the held month ends summed.
    expect(view.netWorth).toEqual([
      { total: 6_000_00n, partial: true },
      { total: 9_200_50n, partial: false },
      { total: 9_000_00n, partial: false },
    ]);
    expect(view.total).toBe(9_000_00n);
    expect(view.previousTotal).toBe(9_200_50n);
    expect(view.buckets.cash.total).toBe(900_00n);
    expect(view.buckets.savings.total).toBe(5_100_00n);
    expect(view.buckets.investments.total).toBe(3_000_00n);
    // And the same as the formula of Accounts F1, computed from the rows' own figures.
    expect(view.netWorth).toEqual(
      totalSeries(
        view.rows.map((row) => row.held),
        3,
      ),
    );
    for (const row of view.rows) {
      expect(row.display).toEqual({ balance: row.balance, previous: row.previous, held: row.held });
      expect(row.missingRate).toBe(false);
    }
  });

  it("keeps the summary and the snapshot on the same numbers", async () => {
    await seed();
    const figures = await monthlyFigures(ctx, "2026-03-01", NOW);
    expect(figures).toMatchObject({
      currency: "EUR",
      netWorthCents: 9_000_00n,
      netWorthPartial: false,
      // A one-month window has no month before it: null, exactly as before phase 1b.
      previousNetWorthCents: null,
      cashCents: 900_00n,
    });

    const outcome = await runSnapshot(ctx, "2026-02-01", NOW);
    expect(outcome).toMatchObject({ total: 9_200_50n, currency: "EUR", written: 3 });
    const [run] = await listSnapshotRuns(ctx);
    expect(run).toMatchObject({ totalCents: 9_200_50n, totalCurrency: "EUR" });
  });
});

describe("accounts in EUR and USD", () => {
  async function seed() {
    await usdRates();
    await account("Conto", "checking", "EUR", [["2026-01-10", 1_000_00n]]);
    return account("Broker USD", "investment", "USD", [
      ["2026-01-12", 1_000_00n],
      ["2026-02-10", 2_000_00n],
    ]);
  }

  it("converts each month end at its own day's rate into EUR", async () => {
    const usd = await seed();
    const view = await accountsView(ctx, { months: 3, now: NOW });

    // 31/01 and 28/02 are Saturdays: the Friday fixing before. Today takes the latest, 13/03.
    expect(view.netWorth.map((point) => point.total)).toEqual([1_900_00n, 2_600_00n, 2_700_00n]);
    expect(view.total).toBe(2_700_00n);
    expect(view.previousTotal).toBe(2_600_00n);
    expect(view.buckets.investments.total).toBe(1_700_00n);
    const row = view.rows.find((one) => one.account.id === usd.id);
    // The account's own figures stay in dollars.
    expect(row?.balance).toBe(2_000_00n);
    expect(row?.held).toEqual([1_000_00n, 2_000_00n, 2_000_00n]);
    expect(row?.display).toEqual({
      balance: 1_700_00n,
      previous: 1_600_00n,
      held: [900_00n, 1_600_00n, 1_700_00n],
    });
  });

  it("shows every total in the display currency the person chose in Settings", async () => {
    await seed();
    await updatePreferences(ctx, { ...DEFAULT_PREFERENCES, displayCurrency: "USD" });
    // The context a job (and a request) builds from the saved preferences.
    const usdCtx = await jobContextFor({ id: userId });
    expect(usdCtx.displayCurrency).toBe("USD");

    const view = await accountsView(usdCtx, { months: 3, now: NOW });
    expect(view.currency).toBe("USD");
    // 1,000 EUR is 1,111.11 USD at 0.90, 1,250 at 0.80, 1,176.47 at 0.85.
    expect(view.netWorth.map((point) => point.total)).toEqual([2_111_11n, 3_250_00n, 3_176_47n]);
    expect((await monthlyFigures(usdCtx, "2026-03-01", NOW)).currency).toBe("USD");
  });

  it("saves the snapshot total in the display currency of the run, with that currency", async () => {
    await seed();
    const outcome = await runSnapshot(contextFor(userId, "USD"), "2026-02-01", NOW);
    expect(outcome).toMatchObject({ total: 3_250_00n, currency: "USD" });
    const [run] = await listSnapshotRuns(ctx);
    expect(run).toMatchObject({ totalCents: 3_250_00n, totalCurrency: "USD" });

    // Running the same month again rewrites the row, with the currency of that run.
    await runSnapshot(ctx, "2026-02-01", NOW);
    const [again] = await listSnapshotRuns(ctx);
    expect(again).toMatchObject({ totalCents: 2_600_00n, totalCurrency: "EUR" });
  });

  it("rounds each account to the cent before summing", async () => {
    await saveRates([{ on: "2026-03-13", currency: "USD", eurPerUnit: "0.5000000000" }]);
    await account("A", "checking", "USD", [["2026-03-01", 1n]]);
    await account("B", "checking", "USD", [["2026-03-01", 1n]]);
    const view = await accountsView(ctx, { months: 1, now: NOW });
    // Half a cent each, rounded away from zero: two cents, where summing first would give one.
    expect(view.total).toBe(2n);
  });

  it("leaves an account with no rate out of the total and marks it partial, never 1:1", async () => {
    await usdRates();
    await account("Conto", "checking", "EUR", [["2026-01-10", 1_000_00n]]);
    await account("Konto", "checking", "SEK", [["2026-01-10", 5_000_00n]]);
    const view = await accountsView(ctx, { months: 1, now: NOW });

    expect(view.total).toBe(1_000_00n);
    expect(view.totalPartial).toBe(true);
    expect(view.buckets.cash).toMatchObject({ total: 1_000_00n, partial: true });
    expect(view.missingRates).toEqual(["SEK"]);
    const sek = view.rows.find((row) => row.account.currency === "SEK");
    expect(sek?.missingRate).toBe(true);
    expect(sek?.balance).toBe(5_000_00n);
  });
});

describe("an account's currency", () => {
  it("cannot change once the account has a balance", async () => {
    const usd = await account("Broker", "investment", "USD", [["2026-01-12", 1_000_00n]]);
    await expect(
      updateAccountSettings(ctx, usd.id, {
        ...SETTINGS,
        name: "Broker",
        type: "investment",
        currency: "EUR",
      }),
    ).rejects.toEqual(new AccountError("currency_locked"));
    // The other settings still save.
    const saved = await updateAccountSettings(ctx, usd.id, {
      ...SETTINGS,
      name: "Broker US",
      type: "investment",
      currency: "USD",
    });
    expect(saved).toMatchObject({ name: "Broker US", currency: "USD" });
  });

  it("can change while the account has no balance yet", async () => {
    const empty = await account("Empty", "checking", "EUR", []);
    const saved = await updateAccountSettings(ctx, empty.id, {
      ...SETTINGS,
      name: "Empty",
      type: "checking",
      currency: "USD",
    });
    expect(saved.currency).toBe("USD");
  });
});
