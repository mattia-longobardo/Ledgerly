// eToro mapping (docs/design/investments.md §3.3, D17) on the anonymised fixtures of the spike.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SourceError } from "../investments/source";
import {
  balancesSchema,
  cashTransactionSchema,
  type EtoroPortfolio,
  historySchema,
  meSchema,
  portfolioSchema,
  tradeSchema,
} from "./client";
import {
  cashEventsOf,
  flowsCoverage,
  historyFrom,
  historyOf,
  holdingsOf,
  instrumentAsset,
  isPlatformTransfer,
  keyCheckOf,
  productOf,
  tradeEventsOf,
} from "./mapping";

const FIXTURES = join(process.cwd(), "test/fixtures/investments/etoro");
const body = (name: string): unknown =>
  (JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8")) as { body: unknown }).body;

const me = meSchema.parse(body("me"));
const balancesEur = balancesSchema.parse(body("balances-eur-include-zero"));
const balancesUsd = balancesSchema.parse(body("balances-usd-include-zero"));
const emptyPortfolio = portfolioSchema.parse(body("portfolio-empty"));
const trades = tradeSchema.array().parse(body("trade-history"));
const cash = (body("cash-transactions-all") as { results: unknown[] }).results.map((one) =>
  cashTransactionSchema.parse(one),
);
const history = historySchema.parse(body("balances-history"));
const observedAt = new Date("2026-10-28T07:30:00Z");

describe("keyCheckOf (E1)", () => {
  it("accepts the spike's key: every scope ends with :read", () => {
    const check = keyCheckOf(me);
    expect(check.result).toBe("read-only");
    expect(Object.keys(check.permissions)).toHaveLength(16);
    expect(check.externalAccountId).toBe("900001");
    expect(check.ipRestricted).toBeNull();
  });

  it("treats a :write scope as a write", () => {
    expect(keyCheckOf({ ...me, scopes: [...me.scopes, "etoro-public:trade.real:write"] }).result).toBe(
      "write",
    );
  });

  it("treats every other suffix as a write too", () => {
    expect(keyCheckOf({ ...me, scopes: ["etoro-public:money:transfer"] }).result).toBe("write");
    expect(keyCheckOf({ ...me, scopes: ["etoro-public:trade.real:READ"] }).result).toBe("write");
  });

  it("refuses a key that lists no scope at all", () => {
    expect(keyCheckOf({ ...me, scopes: [] }).result).toBe("unknown-flag");
  });
});

describe("productOf (E2)", () => {
  it("maps the account types the adapter reads, and labels the others", () => {
    expect(productOf("Trading")).toEqual({ product: "trading", known: true });
    expect(productOf("Cash")).toEqual({ product: "cash", known: true });
    expect(productOf("Crypto")).toEqual({ product: "crypto", known: true });
    expect(productOf("MoneyFarm")).toEqual({ product: "other:moneyfarm", known: false });
    expect(productOf("Plaee Savings")).toEqual({ product: "other:plaee-savings", known: false });
  });
});

describe("holdingsOf (R1, R5, E7)", () => {
  it("reads the spike's empty account as a valid empty answer, every product in scope", () => {
    const snapshot = holdingsOf({
      balances: balancesEur,
      portfolio: emptyPortfolio,
      instruments: [],
      currency: "EUR",
      observedAt,
    });
    expect(snapshot.empty).toBe(true);
    expect(snapshot.complete).toBe(true);
    expect(snapshot.totalCents).toBe(0n);
    expect(snapshot.cashCents).toBe(0n);
    expect(snapshot.positions).toEqual([]);
    expect(snapshot.externalAccountId).toBe("900001");
    expect(snapshot.scopes).toEqual([
      { product: "cash", complete: true },
      { product: "copy", complete: true },
      { product: "crypto", complete: true },
      { product: "trading", complete: true },
    ]);
  });

  it("refuses an answer in another currency than the account's", () => {
    expect(() =>
      holdingsOf({
        balances: balancesUsd,
        portfolio: emptyPortfolio,
        instruments: [],
        currency: "EUR",
        observedAt,
      }),
    ).toThrow(SourceError);
  });

  const funded = {
    ...balancesEur,
    totalBalance: 1234.56,
    balances: balancesEur.balances.map((account) =>
      account.accountType === "Trading"
        ? { ...account, balance: 1000, displayBalance: 900, exchangeRate: 0.9 }
        : account.currency === "BTC"
          ? { ...account, balance: 0.01, displayBalance: 600, exchangeRate: 60000 }
          : account,
    ),
  };
  const portfolio: EtoroPortfolio = {
    clientPortfolio: {
      positions: [
        {
          positionID: 1,
          instrumentID: 1001,
          isBuy: true,
          amount: 100,
          units: 0.5,
          openRate: 200,
          mirrorID: 0,
          unrealizedPnL: { pnL: 10, closeRate: 220, timestamp: null },
        },
      ],
      mirrors: [
        {
          mirrorID: 7,
          parentUsername: "someone",
          availableAmount: 20,
          positions: [
            {
              positionID: 2,
              instrumentID: 1002,
              isBuy: true,
              amount: 50,
              units: 2,
              openRate: 25,
              mirrorID: 7,
              unrealizedPnL: null,
            },
          ],
        },
      ],
      credit: 0,
    },
  };
  const instruments = [
    { instrumentID: 1001, instrumentDisplayName: "Apple", instrumentTypeID: 5, symbolFull: "AAPL" },
    { instrumentID: 1002, instrumentDisplayName: "Vanguard S&P 500", instrumentTypeID: 6, symbolFull: "VOO" },
  ];

  it("values a position at amount + unrealized P/L, at the trading account's own rate", () => {
    const snapshot = holdingsOf({ balances: funded, portfolio, instruments, currency: "EUR", observedAt });
    expect(snapshot.totalCents).toBe(123456n);
    const apple = snapshot.positions.find((one) => one.asset.symbol === "AAPL");
    expect(apple).toMatchObject({
      product: "trading",
      quantity: "0.5",
      price: "220",
      priceCurrency: "USD",
      valueCents: 9900n,
      asset: { class: "stock", name: "Apple", currency: "USD", externalId: "instrument:1001" },
    });
  });

  it("reads a copy's positions as the copy product (E3) and a coin as the crypto product", () => {
    const snapshot = holdingsOf({ balances: funded, portfolio, instruments, currency: "EUR", observedAt });
    expect(snapshot.positions.find((one) => one.asset.symbol === "VOO")?.product).toBe("copy");
    expect(snapshot.positions.find((one) => one.asset.symbol === "BTC")).toMatchObject({
      product: "crypto",
      quantity: "0.01",
      valueCents: 60000n,
      asset: { class: "crypto", currency: "EUR" },
    });
  });

  it("is partial when a position has no value (R5) and when an unread type holds money", () => {
    const snapshot = holdingsOf({ balances: funded, portfolio, instruments, currency: "EUR", observedAt });
    expect(snapshot.positions.find((one) => one.asset.symbol === "VOO")?.valueCents).toBeNull();
    expect(snapshot.complete).toBe(false);
    expect(snapshot.empty).toBe(false);

    const moneyFarm = {
      ...balancesEur,
      totalBalance: 50,
      balances: [
        ...balancesEur.balances,
        {
          accountId: "x",
          accountType: "MoneyFarm",
          subType: null,
          balance: 50,
          currency: "EUR",
          displayBalance: 50,
          displayCurrency: "EUR",
          exchangeRate: 1,
        },
      ],
    };
    const other = holdingsOf({
      balances: moneyFarm,
      portfolio: emptyPortfolio,
      instruments: [],
      currency: "EUR",
      observedAt,
    });
    expect(other.complete).toBe(false);
    expect(other.scopes).toContainEqual({ product: "other:moneyfarm", complete: false });
    expect(other.totalCents).toBe(5000n);
  });

  it("names an instrument without metadata by its id", () => {
    expect(instrumentAsset(42, new Map())).toMatchObject({
      name: "eToro 42",
      symbol: "ETORO-42",
      class: "other",
    });
  });
});

describe("tradeEventsOf (E3, E4)", () => {
  const events = tradeEventsOf(trades, new Map());

  it("makes two events of every closed trade, with stable ids", () => {
    expect(events).toHaveLength(trades.length * 2);
    expect(events.map((event) => event.externalId)).toContain("trade:900011:open");
    expect(events.map((event) => event.externalId)).toContain("trade:900011:close");
    expect(new Set(events.map((event) => event.externalId)).size).toBe(events.length);
  });

  it("buys the units at the open rate and closes for what came back", () => {
    const open = events.find((event) => event.externalId === "trade:900015:open");
    const close = events.find((event) => event.externalId === "trade:900015:close");
    expect(open?.legs[0]).toMatchObject({
      kind: "buy",
      product: "trading",
      quantity: "2.54257562",
      unitPrice: "164.62",
      nativeAmount: "418.5588",
      nativeCurrency: "USD",
    });
    expect(close?.legs[0]).toMatchObject({ kind: "close", unitPrice: "202.94", nativeAmount: "515.9909" });
    expect(open?.occurredAt.toISOString()).toBe("2026-06-12T16:16:41.860Z");
  });

  it("files a copy trade under the copy product and notes a short", () => {
    expect(events.find((event) => event.externalId === "trade:900011:open")?.legs[0].product).toBe("copy");
    expect(events.find((event) => event.externalId === "trade:900017:open")?.note).toBe("short");
  });
});

describe("cashEventsOf and flowsCoverage (E5)", () => {
  it("keeps the bank transfers and drops the transfers with the trading platform", () => {
    expect(cash.filter(isPlatformTransfer)).toHaveLength(4);
    const events = cashEventsOf(cash);
    expect(
      events.map((event) => [event.legs[0].kind, event.legs[0].nativeAmount, event.legs[0].nativeCurrency]),
    ).toEqual([
      ["withdrawal", "888.5846", "EUR"],
      ["deposit", "740", "EUR"],
    ]);
  });

  it("skips what is not settled", () => {
    expect(cashEventsOf([{ ...cash[0], status: "pending" }])).toEqual([]);
  });

  it("declares the deposits partial before the first movement of eToro Money", () => {
    const now = new Date("2026-10-28T08:00:00Z");
    const windows = flowsCoverage(cash, true, now);
    expect(windows).toContainEqual({
      stream: "trades",
      fromAt: new Date("2020-01-01T00:00:00Z"),
      toAt: now,
      status: "complete",
      reason: null,
    });
    const deposits = windows.filter((window) => window.stream === "deposits");
    expect(deposits.map((window) => window.status)).toEqual(["partial", "complete"]);
    expect(deposits[0].reason).toBe("before_first_movement");
    expect(deposits[1].fromAt.toISOString()).toBe("2026-06-10T09:06:55.000Z");
    expect(flowsCoverage([], false, now).filter((window) => window.stream === "deposits")).toEqual([
      expect.objectContaining({ status: "partial", reason: "before_first_movement" }),
    ]);
  });
});

describe("historyOf (D11)", () => {
  it("keeps one total a day before today and declares the 12-month limit", () => {
    const todayOn = "2026-10-27";
    const read = historyOf(history, "EUR", historyFrom(todayOn), todayOn);
    expect(read.points).toEqual([
      { on: "2025-11-01", totalCents: 11n },
      { on: "2026-02-22", totalCents: 11n },
      { on: "2026-10-26", totalCents: 0n },
    ]);
    expect(read.coverage.map((window) => [window.status, window.reason])).toEqual([
      ["gap", "api_limit_12m"],
      ["complete", null],
    ]);
  });

  it("drops today's snapshot and refuses another currency", () => {
    expect(historyOf(history, "EUR", "2025-11-01", "2026-10-26").points.at(-1)?.on).toBe("2026-02-22");
    expect(() => historyOf(history, "USD", "2025-11-01", "2026-10-27")).toThrow(SourceError);
  });
});
