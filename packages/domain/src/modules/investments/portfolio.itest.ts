// The manual portfolio (rewrite plan R5d, D2): positions and cash typed by hand, the account's value
// written by the module; never a sale of more than is held.
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createAccount, readingsAt } from "../accounts";
import type { Ctx } from "../../platform/context";
import { today } from "../../shared/dates";
import { getDb } from "../../platform/db/client";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { createTestUser } from "../../../../../test/users";
import { serviceKind } from "../portfolio";
import { PRICE_SCALE, QUANTITY_SCALE } from "./rules";
import { parseDecimal } from "../../shared/money";
import { refreshPrices, searchInstruments } from "../instruments";
import {
  addAsset,
  convertToPortfolio,
  createManualService,
  createPortfolio,
  createPortfolioWithAccount,
  deleteOperation,
  isPortfolio,
  listInvestmentAccounts,
  recordOperation,
  revalueAfterPrices,
  setPriceMode,
} from "./service";
import { investmentAccounts, investmentHoldings } from "./schema";

const qty = (value: string) => parseDecimal(value, QUANTITY_SCALE);
const price = (value: string) => parseDecimal(value, PRICE_SCALE);
const ETF = { create: { class: "etf" as const, name: "An ETF", symbol: "ETF", currency: "EUR" } };

let ctx: Ctx;
let todayOn: string;

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
  todayOn = today(ctx.timeZone);
});

afterAll(closeDatabase);

const valueOf = async (accountId: string) => (await readingsAt(ctx, [accountId], todayOn)).get(accountId);

describe("a manual portfolio", () => {
  it("keeps cash and positions: a deposit, a purchase and its fee, the value of both", async () => {
    const { accountId } = await createPortfolioWithAccount(ctx, {
      name: "Broker",
      currency: "EUR",
      url: null,
    });
    expect(await isPortfolio(ctx, accountId)).toBe(true);
    const [service] = await listInvestmentAccounts(ctx);
    expect(serviceKind({ provider: service.provider, accountOrigin: "manual" })).toBe("manual_portfolio");
    await recordOperation(ctx, accountId, { kind: "deposit", on: todayOn, amountCents: 2_000_00n });
    await addAsset(ctx, accountId, {
      asset: ETF,
      on: todayOn,
      quantity: qty("10"),
      unitPrice: price("100"),
      feeCents: 5_00n,
    });
    // 2,000 in, 1,000 of the ETF and 5 of fee out: 995 of cash and 1,000 of positions.
    expect(await valueOf(accountId)).toBe(1_995_00n);
  });

  it("refuses a sale of more than is held, and a purchase deleted under a later sale", async () => {
    const { accountId } = await createPortfolioWithAccount(ctx, {
      name: "Broker",
      currency: "EUR",
      url: null,
    });
    await recordOperation(ctx, accountId, { kind: "deposit", on: todayOn, amountCents: 2_000_00n });
    const bought = await addAsset(ctx, accountId, {
      asset: ETF,
      on: todayOn,
      quantity: qty("10"),
      unitPrice: price("100"),
    });
    const [service] = await listInvestmentAccounts(ctx);
    expect(service.provider).toBe("portfolio");
    const holdingId = await holdingOf(accountId);
    await expect(
      recordOperation(ctx, accountId, {
        kind: "sell",
        holdingId,
        on: todayOn,
        quantity: qty("11"),
        unitPrice: price("110"),
      }),
    ).rejects.toMatchObject({ code: "quantity_exceeded" });
    await recordOperation(ctx, accountId, {
      kind: "sell",
      holdingId,
      on: todayOn,
      quantity: qty("4"),
      unitPrice: price("110"),
    });
    await expect(deleteOperation(ctx, bought.eventId, accountId)).rejects.toMatchObject({
      code: "quantity_exceeded",
    });
    // 2,000 − 1,000 + 440 of cash, 6 units at the last price of 110.
    expect(await valueOf(accountId)).toBe(1_440_00n + 660_00n);
  });

  it("starts from the balance of its account, and is refused on an account already a service", async () => {
    const account = await createAccount(ctx, {
      name: "Broker",
      type: "investment",
      currency: "EUR",
      openingBalance: { on: "2026-01-01", cents: 500_00n },
    });
    await createPortfolio(ctx, { accountId: account.id });
    expect(await valueOf(account.id)).toBe(500_00n);
    await expect(createPortfolio(ctx, { accountId: account.id })).rejects.toMatchObject({
      code: "not_eligible",
    });
  });
});

async function holdingOf(accountId: string): Promise<string> {
  const [row] = await getDb()
    .select({ id: investmentHoldings.id })
    .from(investmentHoldings)
    .innerJoin(investmentAccounts, eq(investmentAccounts.id, investmentHoldings.investmentAccountId))
    .where(eq(investmentAccounts.accountId, accountId));
  return row.id;
}

// A public example ISIN (ISO 6166), no person's data; the registers and the source are fakes.
const ISIN = "US0378331005";
const REGISTERS = (async (input: string | URL | Request) => {
  const figi = [
    { data: [{ ticker: "EXA", exchCode: "IM", shareClassFIGI: "BBG000000001", securityType: "ETP" }] },
  ];
  const firds = {
    response: {
      docs: [{ gnr_full_name: "Example ETF", gnr_cfi_code: "CEOGLS", gnr_notional_curr_code: "EUR" }],
    },
  };
  return new Response(JSON.stringify(new URL(String(input)).host === "api.openfigi.com" ? figi : firds));
}) as typeof globalThis.fetch;

/** The example instrument in the registry, its Milan market priced by the source `prices`. */
async function instrument(): Promise<{ instrumentId: string; listingId: string }> {
  const [hit] = (await searchInstruments(ISIN, { fetch: REGISTERS, priceSourceId: "prices" })).items;
  return { instrumentId: hit.instrumentId, listingId: hit.listings[0].listingId };
}

/** The source closes the market at `close` today, and the portfolios on it are rewritten. */
async function closeAt(listingId: string, close: string) {
  const run = await refreshPrices({
    source: {
      id: "prices",
      closes: async (request) => ({
        bars: request.listings.map((one) => ({ key: one.key, on: todayOn, close, currency: "EUR" })),
        errors: [],
      }),
    },
    markets: [{ listingId, neededFrom: todayOn }],
    today: todayOn,
    cap: 10,
  });
  await revalueAfterPrices(ctx, run);
}

describe("a portfolio's cash (D2: refused below zero)", () => {
  it("refuses a purchase with no money for it, and takes one with its deposit of the same day", async () => {
    const { accountId } = await createPortfolioWithAccount(ctx, {
      name: "Broker",
      currency: "EUR",
      url: null,
    });
    const order = { asset: ETF, on: todayOn, quantity: qty("10"), unitPrice: price("100"), feeCents: 5_00n };
    await expect(addAsset(ctx, accountId, order)).rejects.toMatchObject({ code: "negative_cash" });
    // Both on the same day, the purchase typed first: the end of the day counts, not the order.
    await recordOperation(ctx, accountId, { kind: "deposit", on: todayOn, amountCents: 500_00n });
    await expect(addAsset(ctx, accountId, order)).rejects.toMatchObject({ code: "negative_cash" });
    await recordOperation(ctx, accountId, { kind: "deposit", on: todayOn, amountCents: 505_00n });
    await addAsset(ctx, accountId, order);
    expect(await valueOf(accountId)).toBe(1_000_00n);
    await expect(
      recordOperation(ctx, accountId, { kind: "withdrawal", on: todayOn, amountCents: 1n }),
    ).rejects.toMatchObject({ code: "negative_cash" });
  });

  it("pays a fee of its own from the cash, and refuses one with no money for it (PERS-591)", async () => {
    const { accountId } = await createPortfolioWithAccount(ctx, {
      name: "Broker",
      currency: "EUR",
      url: null,
    });
    await recordOperation(ctx, accountId, { kind: "deposit", on: todayOn, amountCents: 10_00n });
    await recordOperation(ctx, accountId, { kind: "fee", on: todayOn, amountCents: 3_00n });
    expect(await valueOf(accountId)).toBe(7_00n);
    await expect(
      recordOperation(ctx, accountId, { kind: "fee", on: todayOn, amountCents: 8_00n }),
    ).rejects.toMatchObject({
      code: "negative_cash",
    });
  });

  it("refuses to delete a deposit a purchase spends", async () => {
    const { accountId } = await createPortfolioWithAccount(ctx, {
      name: "Broker",
      currency: "EUR",
      url: null,
    });
    const { eventId } = await recordOperation(ctx, accountId, {
      kind: "deposit",
      on: todayOn,
      amountCents: 1_000_00n,
    });
    await addAsset(ctx, accountId, { asset: ETF, on: todayOn, quantity: qty("10"), unitPrice: price("100") });
    await expect(deleteOperation(ctx, eventId, accountId)).rejects.toMatchObject({ code: "negative_cash" });
    expect(await valueOf(accountId)).toBe(1_000_00n);
  });
});

describe("a portfolio's prices", () => {
  it("values an automatic asset at the close of its market, and by hand once switched", async () => {
    const { instrumentId, listingId } = await instrument();
    const { accountId } = await createPortfolioWithAccount(ctx, {
      name: "Broker",
      currency: "EUR",
      url: null,
    });
    await recordOperation(ctx, accountId, { kind: "deposit", on: todayOn, amountCents: 2_000_00n });
    await addAsset(ctx, accountId, {
      asset: { instrument: { instrumentId, mic: "XMIL" } },
      on: todayOn,
      quantity: qty("10"),
      unitPrice: price("100"),
    });
    await closeAt(listingId, "110");
    expect(await valueOf(accountId)).toBe(1_000_00n + 1_100_00n);
    await setPriceMode(ctx, accountId, await holdingOf(accountId), "manual");
    expect(await valueOf(accountId)).toBe(2_000_00n);
  });

  it("refuses an automatic price on a market no source has", async () => {
    const [hit] = (await searchInstruments(ISIN, { fetch: REGISTERS, priceSourceId: null })).items;
    const { accountId } = await createPortfolioWithAccount(ctx, {
      name: "Broker",
      currency: "EUR",
      url: null,
    });
    await recordOperation(ctx, accountId, { kind: "deposit", on: todayOn, amountCents: 2_000_00n });
    await addAsset(ctx, accountId, {
      asset: { instrument: { instrumentId: hit.instrumentId, mic: "XMIL" } },
      on: todayOn,
      quantity: qty("1"),
      unitPrice: price("100"),
    });
    await expect(setPriceMode(ctx, accountId, await holdingOf(accountId), "auto")).rejects.toMatchObject({
      code: "not_editable",
    });
  });
});

describe("«Switch to positions» (D4)", () => {
  it("keeps the value of the day and the history before, the positions open at their price", async () => {
    const { instrumentId } = await instrument();
    const account = await createAccount(ctx, {
      name: "Bank titles",
      type: "investment",
      currency: "EUR",
      openingBalance: { on: "2026-01-01", cents: 5_000_00n },
    });
    await createManualService(ctx, { accountId: account.id, category: "broker" });
    const positions = [{ instrumentId, mic: "XMIL", quantity: qty("10"), unitPrice: price("100") }];
    await expect(
      convertToPortfolio(ctx, account.id, {
        on: todayOn,
        positions: [{ ...positions[0], quantity: qty("60") }],
      }),
    ).rejects.toMatchObject({ code: "negative_cash" });
    await convertToPortfolio(ctx, account.id, { on: todayOn, positions });
    expect(await isPortfolio(ctx, account.id)).toBe(true);
    expect(await valueOf(account.id)).toBe(5_000_00n);
    expect((await readingsAt(ctx, [account.id], "2026-06-01")).get(account.id)).toBe(5_000_00n);
    // The cash is the rest: 4,000 after the 1,000 of positions; a sale brings it back.
    await recordOperation(ctx, account.id, {
      kind: "sell",
      holdingId: await holdingOf(account.id),
      on: todayOn,
      quantity: qty("10"),
      unitPrice: price("100"),
    });
    expect(await valueOf(account.id)).toBe(5_000_00n);
    await expect(convertToPortfolio(ctx, account.id, { on: todayOn, positions: [] })).rejects.toMatchObject({
      code: "not_eligible",
    });
  });
});
