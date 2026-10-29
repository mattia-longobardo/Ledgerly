// The Binance source on a fake exchange (docs/design/investments.md §3.2, A7, B2, B3, B7): the
// windows of each stream, the cursor with its 24 hours of overlap, the markets found from every
// stream, events in the same millisecond, and the 12 months kept (PERS-141).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BinanceApi } from "./client";
import { binanceSource } from "./source";

const FIXTURES = join(process.cwd(), "test/fixtures/investments/binance");
const body = (name: string): unknown =>
  (JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8")) as { body: unknown }).body;

const DAY = 86_400_000;
const NOW = new Date("2026-10-28T10:00:00Z");
const KEYS = { api_key: "canary-binance-key-31c7", secret: "canary-binance-secret-8e02" };

type Call = [string, ...unknown[]];

function fakeApi(overrides: Partial<BinanceApi> = {}) {
  const calls: Call[] = [];
  const log =
    <T>(name: string, answer: (...args: never[]) => T) =>
    async (...args: unknown[]) => {
      calls.push([name, ...args]);
      return (answer as (...args: unknown[]) => T)(...args);
    };
  const api: BinanceApi = {
    apiRestrictions: log("apiRestrictions", () => body("api-restrictions")),
    account: log("account", () => body("account")),
    walletBalance: log("walletBalance", () => body("wallet-balance")),
    fundingBalance: log("fundingBalance", () => (body("balance-funding") as { info: unknown }).info),
    earnFlexible: log("earnFlexible", () => body("earn-flexible-empty")),
    earnLocked: log("earnLocked", () => body("earn-locked-empty")),
    markets: log("markets", () => ["ETH/EUR", "ETH/USDT", "EUR/USDT", "BNB/EUR", "TRX/USDT", "SUI/USDT"]),
    tradeMarkets: log("tradeMarkets", () => [
      "ETH/EUR",
      "ETH/USDT",
      "EUR/USDT",
      "BNB/EUR",
      "TRX/USDT",
      "SUI/USDT",
    ]),
    tickers: log("tickers", () => body("tickers")),
    dailyCandles: log("dailyCandles", () => []),
    deposits: log("deposits", () => []),
    withdrawals: log("withdrawals", () => []),
    fiatOrders: log("fiatOrders", () => ({ data: [] })),
    fiatPayments: log("fiatPayments", () => ({ data: [] })),
    convertFlow: log("convertFlow", () => ({ list: [] })),
    dividends: log("dividends", () => ({ rows: [] })),
    dustLog: log("dustLog", () => ({ total: 0, userAssetDribblets: [] })),
    payTransactions: log("payTransactions", () => ({ data: [] })),
    myTrades: log("myTrades", () => []),
    // An override answers in place of the default and is logged the same way.
    ...Object.fromEntries(
      Object.entries(overrides).map(([name, answer]) => [
        name,
        log(name, answer as (...args: never[]) => unknown),
      ]),
    ),
  };
  return { api, calls };
}

const named = (calls: Call[], name: string) => calls.filter((call) => call[0] === name);

afterEach(() => vi.restoreAllMocks());

describe("fetchFlows (§3.2)", () => {
  it("reads 12 months in the windows of each stream, then declares the rest the opening", async () => {
    const { api, calls } = fakeApi();
    const read = await binanceSource(async () => api).fetchFlows(KEYS, NOW, {
      currency: "EUR",
      cursor: null,
      fx: () => null,
    });
    const from = NOW.getTime() - 365 * DAY;
    expect(read.historyFrom?.getTime()).toBe(from);
    const deposits = named(calls, "deposits");
    expect(deposits).toHaveLength(5);
    expect(deposits[0][1]).toBe(from);
    expect(deposits.at(-1)![2]).toBe(NOW.getTime());
    for (const call of deposits) expect((call[2] as number) - (call[1] as number)).toBeLessThan(90 * DAY);
    expect(named(calls, "withdrawals")).toHaveLength(5);
    expect(named(calls, "convertFlow")).toHaveLength(13);
    expect(named(calls, "dividends")).toHaveLength(3);
    for (const call of named(calls, "dividends")) {
      expect((call[2] as number) - (call[1] as number)).toBeLessThan(180 * DAY);
    }
    // The slow fiat calls (B2): one range each, by pages.
    expect(named(calls, "fiatOrders").map((call) => call.slice(1))).toEqual([
      [0, from, NOW.getTime(), 1],
      [1, from, NOW.getTime(), 1],
    ]);
    expect(named(calls, "fiatPayments")).toHaveLength(1);
    // Pay keeps 18 months, more than the history: read from its start like every other stream.
    const payFrom = from;
    expect(named(calls, "payTransactions")[0][1]).toBe(payFrom);
    for (const call of named(calls, "payTransactions")) {
      expect((call[2] as number) - (call[1] as number)).toBeLessThan(90 * DAY);
    }
    expect(named(calls, "dustLog")).toHaveLength(5);
    const gaps = read.coverage.filter((one) => one.status === "gap");
    expect(gaps.map((one) => one.reason)).toEqual(Array(9).fill("opening_12m"));
    expect(read.cursor).toMatchObject({ history: "3", pay_from: new Date(payFrom).toISOString() });
    expect(read.rebase).toBeUndefined();
    expect(read.cursor).toMatchObject({ from: new Date(from).toISOString(), deposits: NOW.toISOString() });
  });

  it("discovers the markets from every stream and the balances, and follows them by id (B3, B7)", async () => {
    const { api, calls } = fakeApi({
      dividends: async () => body("asset-dividend"),
      myTrades: async (symbol: string) => (symbol === "ETH/USDT" ? body("my-trades") : []),
      markets: async () => ["ETH/EUR", "ETH/USDT", "EUR/USDT", "TRX/USDT", "ROBO/USDT", "BNB/EUR"],
      tradeMarkets: async () => ["ETH/EUR", "ETH/USDT", "EUR/USDT", "TRX/USDT", "ROBO/USDT", "BNB/EUR"],
    });
    // From 2025-11-20: the ETH/USDT trades of 2024-10 and 2024-11 are older than the 12 months.
    const later = new Date("2026-11-20T10:00:00Z");
    const read = await binanceSource(async () => api).fetchFlows(KEYS, later, {
      currency: "EUR",
      cursor: null,
      fx: () => null,
    });
    const symbols = calls.filter((call) => call[0] === "myTrades").map((call) => call[1]);
    // ROBO is only in the rewards, TRX only in the spot balance.
    expect(symbols).toEqual(expect.arrayContaining(["ROBO/USDT", "TRX/USDT", "ETH/EUR", "BNB/EUR"]));
    expect(calls.filter((call) => call[0] === "myTrades").every((call) => call[2] === 0)).toBe(true);
    expect(read.cursor?.["trades:ETH/USDT"]).toBe("900080");
    expect(read.cursor?.assets).toContain("ROBO");
    // Only the 12 months (PERS-141): older trades of a market read by id are dropped.
    expect(read.events.some((one) => one.externalId === "trade:ETHUSDT:900072")).toBe(false);
    expect(read.events.some((one) => one.externalId === "trade:ETHUSDT:900080")).toBe(false);
    expect(read.events.some((one) => one.externalId === "trade:ETHEUR:900076")).toBe(true);
  });

  it("starts each stream again 24 hours before it stopped, and each market at its last id (A7)", async () => {
    const { api, calls } = fakeApi();
    const stopped = new Date(NOW.getTime() - 2 * DAY);
    const cursor = {
      from: new Date(NOW.getTime() - 400 * DAY).toISOString(),
      deposits: stopped.toISOString(),
      withdrawals: stopped.toISOString(),
      "fiat_orders:0": stopped.toISOString(),
      "fiat_orders:1": stopped.toISOString(),
      fiat_payments: stopped.toISOString(),
      convert: stopped.toISOString(),
      dividends: stopped.toISOString(),
      "trades:ETH/EUR": "900076",
      assets: "ETH",
      history: "3",
    };
    const read = await binanceSource(async () => api).fetchFlows(KEYS, NOW, {
      currency: "EUR",
      cursor,
      fx: () => null,
    });
    const restart = stopped.getTime() - DAY;
    expect(named(calls, "deposits")).toEqual([["deposits", restart, NOW.getTime()]]);
    expect(named(calls, "convertFlow")).toEqual([["convertFlow", restart, NOW.getTime()]]);
    expect(named(calls, "fiatOrders")[0]).toEqual(["fiatOrders", 0, restart, NOW.getTime(), 1]);
    expect(named(calls, "myTrades")).toContainEqual(["myTrades", "ETH/EUR", 900_076]);
    // The history keeps its first day; no opening is valued again.
    expect(read.cursor?.from).toBe(cursor.from);
    expect(read.openingRates).toBeUndefined();
  });

  it("follows the coins of the dust log into their markets, delisted ones too (PERS-141)", async () => {
    const { api, calls } = fakeApi({
      dustLog: async () => ({
        userAssetDribblets: [
          {
            userAssetDribbletDetails: [
              {
                transId: 7,
                fromAsset: "MKR",
                amount: "0.0001",
                transferedAmount: "0.00001",
                serviceChargeAmount: "0.0000002",
                operateTime: NOW.getTime() - 10 * DAY,
              },
            ],
          },
        ],
      }),
      tradeMarkets: async () => ["ETH/EUR", "MKR/USDT", "BNB/EUR"],
    });
    const read = await binanceSource(async () => api).fetchFlows(KEYS, NOW, {
      currency: "EUR",
      cursor: null,
      fx: () => null,
    });
    // MKR/USDT is no longer an active market (`markets`), but its trades are still read.
    expect(named(calls, "myTrades").map((call) => call[1])).toContain("MKR/USDT");
    expect(read.events.some((one) => one.externalId === "dust:7:MKR")).toBe(true);
    expect(read.cursor?.assets).toContain("MKR");
  });

  it("rebases a history of 24 months onto 12: openings valued again on the new start, once", async () => {
    const { api, calls } = fakeApi();
    // A connection made 30 days ago under version 2: its history started 24 months before it.
    const connected = NOW.getTime() - 30 * DAY;
    const from = new Date(connected - 730 * DAY).toISOString();
    const older = await binanceSource(async () => api).fetchFlows(KEYS, NOW, {
      currency: "EUR",
      cursor: { from, deposits: NOW.toISOString(), assets: "ETH", history: "2" },
      fx: () => null,
    });
    expect(older.rebase).toBe(true);
    expect(older.openingRates).toBeDefined();
    // Now 12 months before the connection; the cursor keeps it.
    const start = connected - 365 * DAY;
    expect(older.historyFrom?.getTime()).toBe(start);
    expect(older.cursor).toMatchObject({ from: new Date(start).toISOString(), history: "3" });
    // The new streams start at the history, the old ones where they stopped.
    expect(named(calls, "dustLog")[0][1]).toBe(start);
    expect(named(calls, "deposits")[0][1]).toBe(NOW.getTime() - DAY);
    const again = await binanceSource(async () => api).fetchFlows(KEYS, NOW, {
      currency: "EUR",
      cursor: older.cursor ?? null,
      fx: () => null,
    });
    expect(again.rebase).toBeUndefined();
    expect(again.openingRates).toBeUndefined();
    expect(again.historyFrom?.getTime()).toBe(start);
  });

  it("keeps two events of the same millisecond, and one event read twice once", async () => {
    const at = String(NOW.getTime() - 3 * DAY);
    const row = (id: string) => ({ id, asset: "BNB", amount: "0.001", divTime: at, enInfo: "BNB Vault" });
    const { api } = fakeApi({
      dividends: async () => ({ rows: [row("a"), row("b"), row("a")] }),
    });
    const read = await binanceSource(async () => api).fetchFlows(KEYS, NOW, {
      currency: "EUR",
      cursor: null,
      fx: () => null,
    });
    const dividends = read.events.filter((one) => one.externalId.startsWith("dividend:"));
    expect(dividends.map((one) => one.externalId).sort()).toEqual(["dividend:a", "dividend:b"]);
    expect(new Set(dividends.map((one) => one.occurredAt.getTime())).size).toBe(1);
  });

  it("reads a full page of rewards again from its oldest millisecond", async () => {
    const oldest = NOW.getTime() - 3 * DAY;
    const full = Array.from({ length: 500 }, (_, index) => ({
      id: `r${index}`,
      asset: "BNB",
      amount: "0.0001",
      divTime: String(oldest + index),
    }));
    let call = 0;
    const { api, calls } = fakeApi({
      dividends: async () => {
        call += 1;
        return { rows: call === 3 ? full : [] };
      },
    });
    await binanceSource(async () => api).fetchFlows(KEYS, NOW, {
      currency: "EUR",
      cursor: null,
      fx: () => null,
    });
    const reads = named(calls, "dividends");
    expect(reads).toHaveLength(4);
    // The last window again, down to the oldest millisecond of the full page (inclusive).
    expect(reads[3][1]).toBe(reads[2][1]);
    expect(reads[3][2]).toBe(oldest);
  });

  it("reads a pending deposit again on the next pass", async () => {
    const pending = NOW.getTime() - 5 * DAY;
    const { api } = fakeApi({
      deposits: async () => [
        {
          id: "p1",
          timestamp: pending,
          currency: "ETH",
          status: "pending",
          info: { amount: "0.1" },
        },
      ],
    });
    const read = await binanceSource(async () => api).fetchFlows(KEYS, NOW, {
      currency: "EUR",
      cursor: null,
      fx: () => null,
    });
    expect(read.cursor?.deposits).toBe(new Date(pending).toISOString());
    expect(read.events.filter((one) => one.externalId.startsWith("deposit:"))).toEqual([]);
  });

  it("values the coins held on the first day of the history", async () => {
    const from = NOW.getTime() - 365 * DAY;
    const day = Math.floor(from / DAY) * DAY;
    const { api } = fakeApi({
      dailyCandles: async (symbol: string) => (symbol === "BNB/EUR" ? [[day, 0, 0, 0, 500, 0]] : []),
    });
    const read = await binanceSource(async () => api).fetchFlows(KEYS, NOW, {
      currency: "EUR",
      cursor: null,
      fx: () => null,
    });
    expect(read.openingRates?.BNB).toEqual({
      rate: "500",
      source: `exchange:BNB/EUR@${new Date(day).toISOString().slice(0, 10)}`,
    });
  });
});

describe("verifyReadOnly and fetchHoldings", () => {
  it("logs an unknown flag that is off, by name only (B1)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { api } = fakeApi({
      apiRestrictions: async () => ({ ...(body("api-restrictions") as object), enableShinyNew: false }),
    });
    const check = await binanceSource(async () => api).verifyReadOnly(KEYS);
    expect(check.result).toBe("read-only");
    expect(warn).toHaveBeenCalledWith("[investments] ccxt:binance flags off and unknown", "enableShinyNew");
    expect(JSON.stringify(warn.mock.calls)).not.toContain(KEYS.api_key);
  });

  it("asks only for the tickers of listed markets", async () => {
    const { api, calls } = fakeApi();
    const snapshot = await binanceSource(async () => api).fetchHoldings(KEYS, "EUR", NOW, () => null);
    expect(named(calls, "tickers")[0][1]).toEqual(["BNB/EUR", "EUR/USDT", "TRX/USDT"]);
    expect(snapshot.externalAccountId).toBe("900032");
  });
});

describe("fetchDailyRates (PERS-100)", () => {
  it("prices each coin on every day it has a close, directly or through a stablecoin", async () => {
    const first = Date.parse("2026-10-26T00:00:00Z");
    const candles: Record<string, unknown[]> = {
      "ETH/EUR": [
        [first, 0, 0, 0, 2000, 0],
        [first + DAY, 0, 0, 0, 2100, 0],
      ],
      "SUI/USDT": [[first + DAY, 0, 0, 0, 2, 0]],
      "EUR/USDT": [[first + DAY, 0, 0, 0, 1.25, 0]],
    };
    const { api, calls } = fakeApi({ dailyCandles: async (symbol: string) => candles[symbol] ?? [] });
    const rates = await binanceSource(async () => api).fetchDailyRates!(
      KEYS,
      ["ETH", "SUI", "EUR", "ETHW"],
      "EUR",
      new Date(first),
      NOW,
      () => null,
    );
    expect(rates).toEqual({
      ETH: { "2026-10-26": "2000", "2026-10-27": "2100" },
      ETHW: {},
      SUI: { "2026-10-27": "1.6" },
    });
    // Fiat is the module's to convert; a coin with no market asks for nothing.
    expect(named(calls, "dailyCandles").map((call) => call[1])).toEqual(["ETH/EUR", "EUR/USDT", "SUI/USDT"]);
  });
});
