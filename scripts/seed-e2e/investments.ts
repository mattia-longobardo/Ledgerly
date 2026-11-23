// scripts/seed-e2e/investments.ts — the users and the data of the flow `investments` (tests/e2e/investments/).
import { createAccount, saveBalanceEntry, saveProviderBalance } from "@domain/modules/accounts/service";
import { searchInstruments } from "@domain/modules/instruments";
import {
  addAsset,
  createManualService,
  createPortfolioWithAccount,
  PRICE_SCALE,
  QUANTITY_SCALE,
  recordOperation,
} from "@domain/modules/investments";
import { pricesPlugin } from "@domain/platform/plugins";
import { parseDecimal } from "@domain/shared/money";
import { connectInvestmentProvider, setSourcesForTests } from "@domain/modules/investments/sync";
import { upsertFromProvider } from "@domain/modules/transactions/service";
import { type Ctx } from "@domain/platform/context";
import { addDays, today } from "@domain/shared/dates";
import { listConnections, saveSchedule } from "@domain/platform/integrations/service";
import { USERS } from "../../tests/e2e/_shared/env";
import { contextOf, syncedAccount, walletMovement } from "./common";
import { WALLET_PROVIDER } from "../../test/fixtures/providers";

/**
 * Investments (PERS-342): no service yet — the journey adds two from Accounts — a manual investment
 * account, Directa, worth 8.000 € yesterday, and an investment account Wallet reads, Fineco, at zero
 * yesterday, that took 8.000 € in today and holds them. Investments creates no account of its own.
 */
export async function seedInvestments(): Promise<void> {
  const ctx = await contextOf(USERS.investments.email);
  const on = today(ctx.timeZone);
  const account = await syncedAccount(ctx, "e2e-investments-1", "ING Conto Arancio");
  await saveBalanceEntry(ctx, account, { on, cents: 500_000n });
  const directa = await createAccount(ctx, { name: "Directa", type: "investment", currency: "EUR" });
  await saveBalanceEntry(ctx, directa.id, { on: addDays(on, -1), cents: 800_000n });
  const fineco = await syncedAccount(ctx, "e2e-investments-2", "Fineco", "investment");
  await saveProviderBalance(ctx, fineco, { on: addDays(on, -1), cents: 0n });
  await upsertFromProvider(
    ctx,
    fineco,
    [walletMovement("e2e-investments-tx-3", on, 800_000n, "MARIO ROSSI", null)],
    { provider: WALLET_PROVIDER },
  );
  await saveProviderBalance(ctx, fineco, { on, cents: 800_000n });
}

/**
 * A connected eToro service (docs/design/investments.md §3.3) for the screens of phase 3: the
 * connection is made through `connectInvestmentProvider` with a stand-in for eToro, so nothing is
 * sent anywhere, and its schedule is manual, so the dispatcher never tries the made-up key.
 */
export async function seedEtoro(ctx: Ctx, on: string): Promise<void> {
  const asset = (symbol: string, name: string, kind: "stock" | "etf") => ({
    externalId: `instrument:${symbol}`,
    class: kind,
    name,
    symbol,
    currency: "USD",
  });
  const now = new Date();
  setSourcesForTests(() => ({
    verifyReadOnly: async () => ({
      result: "read-only",
      permissions: { "etoro-public:trade.real:read": true, "etoro-public:money.balance:read": true },
      ipRestricted: null,
      externalAccountId: "900001",
    }),
    fetchHoldings: async () => ({
      observedAt: now,
      externalAccountId: "900001",
      totalCents: 512_345n,
      cashCents: 12_345n,
      positions: [
        {
          asset: asset("AAPL", "Apple", "stock"),
          product: "trading",
          quantity: "10",
          price: "230.5",
          priceCurrency: "USD",
          priceSource: "etoro",
          valueCents: 230_500n,
          // What it invested (U4): the Positions tab measures its unrealized from it.
          costCents: 200_000n,
        },
        {
          asset: asset("VOO", "Vanguard S&P 500 ETF", "etf"),
          product: "copy",
          quantity: "0.5",
          price: "540",
          priceCurrency: "USD",
          priceSource: "etoro",
          valueCents: 269_500n,
          costCents: 250_000n,
        },
      ],
      scopes: [
        { product: "cash", complete: true },
        { product: "copy", complete: true },
        { product: "trading", complete: true },
      ],
      empty: false,
      complete: true,
    }),
    fetchFlows: async () => ({
      events: [
        // A trade opened and closed (E4): the closed positions of the Positions tab (U4).
        ...(
          [
            ["open", -30, "buy", "200", "400"],
            ["close", -10, "close", "250", "500"],
          ] as const
        ).map(([side, days, kind, unitPrice, nativeAmount]) => ({
          externalId: `trade:e2e-7:${side}`,
          occurredAt: new Date(`${addDays(on, days)}T15:00:00Z`),
          note: null,
          legs: [
            {
              leg: "base" as const,
              kind,
              asset: asset("TSLA", "Tesla", "stock"),
              product: "trading",
              quantity: "2",
              unitPrice,
              priceCurrency: "USD",
              nativeAmount,
              nativeCurrency: "USD",
            },
          ],
        })),
        {
          externalId: "cash:e2e-1",
          occurredAt: new Date(`${addDays(on, -5)}T09:00:00Z`),
          note: null,
          legs: [
            {
              leg: "main",
              kind: "deposit",
              asset: null,
              product: null,
              quantity: null,
              unitPrice: null,
              priceCurrency: null,
              nativeAmount: "5000",
              nativeCurrency: "USD",
            },
          ],
        },
      ],
      coverage: [
        {
          stream: "trades",
          fromAt: new Date("2020-01-01T00:00:00Z"),
          toAt: now,
          status: "complete",
          reason: null,
        },
        // As `flowsCoverage` writes them (PERS-145): complete from the start of the 12 months.
        {
          stream: "deposits",
          fromAt: new Date("2020-01-01T00:00:00Z"),
          toAt: new Date(`${addDays(on, -360)}T00:00:00Z`),
          status: "partial",
          reason: "before_first_movement",
        },
        {
          stream: "deposits",
          fromAt: new Date(`${addDays(on, -360)}T00:00:00Z`),
          toAt: now,
          status: "complete",
          reason: null,
        },
      ],
    }),
    // The 12 months eToro gives (PERS-145): its first day is the service's cut-off, so the trade
    // of a month ago is inside them.
    fetchHistory: async () => ({
      points: [
        { on: addDays(on, -360), totalCents: 0n },
        { on: addDays(on, -2), totalCents: 500_000n },
        { on: addDays(on, -1), totalCents: 505_000n },
      ],
      coverage: [
        {
          stream: "balance_history",
          fromAt: new Date("2020-01-01T00:00:00Z"),
          toAt: new Date(`${addDays(on, -360)}T00:00:00Z`),
          status: "gap",
          reason: "api_limit_12m",
        },
        {
          stream: "balance_history",
          fromAt: new Date(`${addDays(on, -360)}T00:00:00Z`),
          toAt: now,
          status: "complete",
          reason: null,
        },
      ],
    }),
  }));
  try {
    await connectInvestmentProvider(
      ctx,
      "etoro",
      { api_key: "e2e-not-a-key-0001", user_key: "e2e-not-a-key-0002" },
      // Investments creates no account (PERS-342): the empty one takes the 12 months of history.
      {
        kind: "existing",
        accountId: (await createAccount(ctx, { name: "eToro", type: "investment", currency: "USD" })).id,
      },
    );
  } finally {
    setSourcesForTests(null);
  }
  const etoro = (await listConnections(ctx)).find((one) => one.provider === "etoro");
  if (!etoro) throw new Error("e2e: the eToro connection is missing");
  await saveSchedule(ctx, etoro.id, { rules: [] });
}

/**
 * A connected Binance service (docs/design/investments.md §3.2) for the screens of phase 4: a
 * stand-in for the exchange, as for eToro, with a wallet the adapter does not read (B4), the
 * streams of D18 and the 24-month gap (D11), and a manual schedule.
 */
export async function seedBinance(ctx: Ctx, on: string): Promise<void> {
  const coin = (symbol: string, name: string, kind: "crypto" | "stablecoin" = "crypto") => ({
    externalId: symbol,
    class: kind,
    name,
    symbol,
    currency: kind === "stablecoin" ? "USD" : "EUR",
  });
  const now = new Date();
  const from = new Date(now.getTime() - 730 * 86_400_000);
  const at = (days: number) => new Date(`${addDays(on, -days)}T10:00:00Z`);
  const streams = [
    "deposits",
    "withdrawals",
    "fiat_orders",
    "fiat_payments",
    "convert",
    "dividends",
    "trades",
  ];
  setSourcesForTests(() => ({
    verifyReadOnly: async () => ({
      result: "read-only",
      permissions: { enableReading: true, enableWithdrawals: false, enableSpotAndMarginTrading: false },
      ipRestricted: true,
      externalAccountId: null,
    }),
    fetchHoldings: async () => ({
      observedAt: now,
      externalAccountId: "900032",
      totalCents: 2_250_000n,
      cashCents: 0n,
      positions: [
        {
          asset: coin("BTC", "Bitcoin"),
          product: "spot",
          quantity: "0.0125",
          price: "95000",
          priceCurrency: "EUR",
          priceSource: "binance:BTC/EUR",
          valueCents: 118_750n,
        },
        {
          asset: coin("ETH", "Ethereum"),
          product: "earn",
          quantity: "0.4",
          price: "2100",
          priceCurrency: "EUR",
          priceSource: "binance:ETH/EUR",
          valueCents: 84_000n,
        },
        {
          asset: coin("USDT", "Tether", "stablecoin"),
          product: "funding",
          quantity: "250",
          price: "0.8969",
          priceCurrency: "EUR",
          priceSource: "binance:EUR/USDT",
          valueCents: 22_250n,
        },
      ],
      scopes: [
        { product: "spot", complete: true },
        { product: "funding", complete: true },
        { product: "earn", complete: true },
        { product: "other:cross-margin", complete: false },
      ],
      empty: false,
      complete: false,
    }),
    fetchFlows: async () => ({
      events: [
        {
          externalId: "fiat:e2e-1",
          occurredAt: at(40),
          note: "SEPA",
          legs: [
            {
              leg: "main",
              kind: "deposit",
              asset: null,
              product: null,
              quantity: null,
              unitPrice: null,
              priceCurrency: null,
              nativeAmount: "900",
              nativeCurrency: "EUR",
            },
          ],
        },
        {
          externalId: "trade:ETHEUR:e2e-2",
          occurredAt: at(30),
          note: null,
          legs: [
            {
              leg: "base",
              kind: "buy",
              asset: coin("ETH", "Ethereum"),
              product: "spot",
              quantity: "0.4",
              unitPrice: "2000",
              priceCurrency: "EUR",
              nativeAmount: "800",
              nativeCurrency: "EUR",
            },
          ],
        },
        {
          externalId: "deposit:e2e-3",
          occurredAt: at(20),
          note: null,
          legs: [
            {
              leg: "main",
              kind: "deposit",
              asset: coin("BTC", "Bitcoin"),
              product: "spot",
              quantity: "0.0125",
              unitPrice: null,
              priceCurrency: null,
              nativeAmount: "0.0125",
              nativeCurrency: "BTC",
              fxRate: "92000",
              fxSource: `exchange:BTC/EUR@${addDays(on, -20)}`,
            },
          ],
        },
        {
          externalId: "deposit:e2e-4",
          occurredAt: at(10),
          note: null,
          legs: [
            {
              leg: "main",
              kind: "deposit",
              asset: coin("USDT", "Tether", "stablecoin"),
              product: "spot",
              quantity: "250",
              unitPrice: null,
              priceCurrency: null,
              nativeAmount: "250",
              nativeCurrency: "USDT",
              fxRate: "0.9",
              fxSource: `exchange:EUR/USDT@${addDays(on, -10)}`,
            },
          ],
        },
      ],
      coverage: streams.flatMap((stream) => [
        {
          stream,
          fromAt: new Date("2017-07-14T00:00:00Z"),
          toAt: from,
          status: "gap" as const,
          reason: "api_limit_24m",
        },
        { stream, fromAt: from, toAt: now, status: "complete" as const, reason: null },
      ]),
      cursor: { from: from.toISOString() },
      historyFrom: from,
      openingRates: {},
    }),
    fetchHistory: async () => ({ points: [], coverage: [] }),
  }));
  try {
    await connectInvestmentProvider(
      ctx,
      "ccxt:binance",
      { api_key: "e2e-not-a-key-0003", secret: "e2e-not-a-key-0004" },
      {
        kind: "existing",
        accountId: (await createAccount(ctx, { name: "Binance", type: "crypto", currency: "EUR" })).id,
      },
    );
  } finally {
    setSourcesForTests(null);
  }
  const binance = (await listConnections(ctx)).find((one) => one.provider === "ccxt:binance");
  if (!binance) throw new Error("e2e: the Binance connection is missing");
  await saveSchedule(ctx, binance.id, { rules: [] });
}

/**
 * The instrument the portfolio's journeys buy (R5d): Vanguard FTSE All-World, as OpenFIGI and ESMA
 * FIRDS describe it. The registry is the instance's: it is kept the way a person's search keeps it,
 * with the instance's prices plugin, and the registers are answered here so the seed asks nobody.
 * An instrument the registry already knows is left as it is.
 */
export const PORTFOLIO_ISIN = "IE00BK5BQT80";
const REGISTERS = (async (input: string | URL | Request) => {
  const figi = [
    {
      data: [
        {
          name: "VANGUARD FTSE ALL-WORLD UCITS",
          ticker: "VWCE",
          exchCode: "IM",
          shareClassFIGI: "BBG00RHP3JF9",
          securityType: "ETP",
        },
        {
          name: "VANGUARD FTSE ALL-WORLD UCITS",
          ticker: "VWCE",
          exchCode: "GY",
          shareClassFIGI: "BBG00RHP3JF9",
          securityType: "ETP",
        },
      ],
    },
  ];
  const firds = {
    response: {
      docs: [
        {
          gnr_full_name: "Vanguard FTSE All-World UCITS ETF USD Accumulating",
          gnr_cfi_code: "CEOJLS",
          gnr_notional_curr_code: "USD",
        },
      ],
    },
  };
  return new Response(JSON.stringify(new URL(String(input)).host === "api.openfigi.com" ? figi : firds));
}) as typeof globalThis.fetch;

async function portfolioInstrument(): Promise<string> {
  const plugin = await pricesPlugin();
  const found = await searchInstruments(PORTFOLIO_ISIN, {
    fetch: REGISTERS,
    priceSourceId: plugin?.config.id ?? null,
  });
  return found.items[0].instrumentId;
}

/** A service kept by value: an investment account typed by hand, worth 3.000 € since a month ago. */
async function valueService(email: string): Promise<void> {
  const ctx = await contextOf(email);
  const on = addDays(today(ctx.timeZone), -30);
  const account = await createAccount(ctx, { name: "Titoli", type: "investment", currency: "EUR" });
  await saveBalanceEntry(ctx, account.id, { on, cents: 300_000n });
  await createManualService(ctx, { accountId: account.id, category: "broker", url: null });
}

/**
 * The manual portfolio (R5d): `portfolio` has «Broker», made today, with a deposit of 5.000 € and 10
 * shares bought at 100 € on Borsa Italiana, and «Titoli» kept by value; `portfolioJourney` has «Titoli» only.
 */
export async function seedPortfolio(): Promise<void> {
  const instrumentId = await portfolioInstrument();
  const ctx = await contextOf(USERS.portfolio.email);
  const on = today(ctx.timeZone);
  const { accountId } = await createPortfolioWithAccount(ctx, { name: "Broker", currency: "EUR", url: null });
  await recordOperation(ctx, accountId, { kind: "deposit", on, amountCents: 500_000n });
  await addAsset(ctx, accountId, {
    asset: { instrument: { instrumentId, mic: "XMIL" } },
    on,
    quantity: parseDecimal("10", QUANTITY_SCALE),
    unitPrice: parseDecimal("100", PRICE_SCALE),
  });
  await valueService(USERS.portfolio.email);
  await valueService(USERS.portfolioJourney.email);
}
