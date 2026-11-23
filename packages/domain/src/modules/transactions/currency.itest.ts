// Decision D4 (audit TRX-2, TR-4), against a real Postgres: every total of movements is in the
// person's display currency, a movement in another currency converted at the ECB rate of its own
// day, as the accounts' totals are. A person with every movement in EUR reads the plain sums.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createAccount } from "../accounts/service";
import type { Ctx } from "../../platform/context";
import { saveRates } from "../../platform/fx/service";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { createTestUser } from "../../../../../test/users";
import {
  categoryMacroTotals,
  categoryTotals,
  monthlyTotals,
  spendingOverTime,
  transactionsSummary,
} from "./queries";
import type { IncomingTransaction } from "./rules";
import { upsertFromProvider } from "./service";
import { WALLET_PROVIDER } from "../../../../../test/fixtures/providers";

let ctx: Ctx;

beforeEach(async () => {
  await resetDatabase();
  ctx = {
    userId: (await createTestUser()).id,
    role: "user",
    locale: "en",
    timeZone: "Europe/Rome",
    numberFormat: "it-IT",
    displayCurrency: "EUR",
  };
});
afterAll(closeDatabase);

const MARCH = { from: "2026-03-01", to: "2026-03-31" };

function movement(id: string, day: string, cents: bigint, currency: string): IncomingTransaction {
  return {
    externalId: id,
    counterpartExternalId: null,
    occurredAt: new Date(`${day}T09:00:00Z`),
    amountCents: cents,
    currency,
    type: cents < 0n ? "expense" : "income",
    state: "cleared",
    payee: id,
    note: null,
    categoryExternalId: null,
    categoryName: null,
    categoryGroupExternalId: null,
    categoryGroupName: null,
    labels: [],
  };
}

async function accountWith(currency: string, movements: IncomingTransaction[]) {
  const created = await createAccount(ctx, { name: currency, type: "checking", currency });
  await upsertFromProvider(ctx, created.id, movements, { provider: WALLET_PROVIDER, window: MARCH });
}

const EUR_MOVEMENTS = [
  movement("eur-1", "2026-03-10", -100_00n, "EUR"),
  movement("eur-2", "2026-03-15", 1_000_00n, "EUR"),
];

/** USD fixings on Friday 06/03 and Friday 13/03: a Saturday takes the Friday before. */
async function usdRates() {
  await saveRates([
    { on: "2026-03-06", currency: "USD", eurPerUnit: "0.9000000000" },
    { on: "2026-03-13", currency: "USD", eurPerUnit: "0.8000000000" },
  ]);
}

describe("an EUR and a USD account, display currency EUR", () => {
  beforeEach(async () => {
    await usdRates();
    await accountWith("EUR", EUR_MOVEMENTS);
    await accountWith("USD", [
      movement("usd-1", "2026-03-09", -50_00n, "USD"), // at 0.90: -45.00 EUR
      movement("usd-2", "2026-03-14", -20_00n, "USD"), // Saturday, at 0.80: -16.00 EUR
      movement("usd-3", "2026-03-16", 10_00n, "USD"), // at 0.80: 8.00 EUR
    ]);
  });

  it("converts every total at the rate of each movement's day", async () => {
    expect(await transactionsSummary(ctx, MARCH)).toEqual({
      count: 5,
      incomeCents: 1_008_00n,
      expenseCents: -161_00n,
      netCents: 847_00n,
      transferCount: 0,
      unpairedTransferCount: 0,
    });
    expect(await monthlyTotals(ctx, MARCH)).toEqual([{ month: "2026-03-01", count: 5, netCents: 847_00n }]);
    expect((await categoryTotals(ctx, MARCH)).map((slice) => [slice.count, slice.totalCents])).toEqual([
      [5, 847_00n],
    ]);
    expect(
      (await categoryMacroTotals(ctx, MARCH)).map((row) => [row.type, row.count, row.inCents, row.outCents]),
    ).toEqual([
      ["expense", 3, 0n, -161_00n],
      ["income", 2, 1_008_00n, 0n],
    ]);
    expect((await spendingOverTime(ctx, MARCH, "day")).map((point) => [point.bucket, point.cents])).toEqual([
      ["2026-03-09", 45_00n],
      ["2026-03-10", 100_00n],
      ["2026-03-14", 16_00n],
    ]);
  });

  it("converts the EUR movements too when the display currency is USD", async () => {
    // -100 EUR at 0.90 is -111.11 USD; 1,000 EUR at 0.80 is 1,250 USD.
    const usd: Ctx = { ...ctx, displayCurrency: "USD" };
    expect(await transactionsSummary(usd, MARCH)).toMatchObject({
      incomeCents: 1_260_00n,
      expenseCents: -181_11n,
      netCents: 1_078_89n,
    });
  });
});

describe("a movement with no rate for its day", () => {
  it("is left out of the totals, never counted 1:1, as an account with no rate is", async () => {
    await usdRates();
    await accountWith("EUR", EUR_MOVEMENTS);
    // Before the first stored USD rate.
    await accountWith("USD", [movement("usd-early", "2026-03-02", -50_00n, "USD")]);
    expect(await transactionsSummary(ctx, MARCH)).toMatchObject({
      count: 3,
      expenseCents: -100_00n,
      netCents: 900_00n,
    });
  });

  it("says how many movements each total left out (excludedCount)", async () => {
    await usdRates();
    await accountWith("EUR", EUR_MOVEMENTS);
    await accountWith("USD", [
      movement("usd-early", "2026-03-02", -50_00n, "USD"), // before the first rate: left out
      movement("usd-later", "2026-03-09", -10_00n, "USD"), // at 0.90: -9.00 EUR
    ]);
    expect(await transactionsSummary(ctx, MARCH)).toMatchObject({ expenseCents: -109_00n, excludedCount: 1 });
    expect(await monthlyTotals(ctx, MARCH)).toEqual([
      { month: "2026-03-01", count: 4, netCents: 891_00n, excludedCount: 1 },
    ]);
    expect((await categoryTotals(ctx, MARCH)).map((slice) => slice.excludedCount)).toEqual([1]);
    expect((await categoryMacroTotals(ctx, MARCH)).map((row) => [row.type, row.excludedCount])).toEqual([
      ["expense", 1],
      ["income", undefined],
    ]);
    expect(
      (await spendingOverTime(ctx, MARCH, "day")).map((point) => [point.bucket, point.excludedCount]),
    ).toEqual([
      ["2026-03-02", 1],
      ["2026-03-09", undefined],
      ["2026-03-10", undefined],
    ]);
  });
});

describe("every movement in EUR", () => {
  it("reads the plain sums, rate or no rate", async () => {
    await usdRates();
    await accountWith("EUR", EUR_MOVEMENTS);
    expect(await transactionsSummary(ctx, MARCH)).toEqual({
      count: 2,
      incomeCents: 1_000_00n,
      expenseCents: -100_00n,
      netCents: 900_00n,
      transferCount: 0,
      unpairedTransferCount: 0,
    });
    expect(await monthlyTotals(ctx, MARCH)).toEqual([{ month: "2026-03-01", count: 2, netCents: 900_00n }]);
  });
});
