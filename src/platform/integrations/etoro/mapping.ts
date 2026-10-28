/**
 * From eToro's answers to the shapes of the investment contract (docs/design/investments.md §3.3,
 * D17). Pure: the fixtures of the spike (`test/fixtures/investments/etoro/`) drive every case.
 */
import { addDays, type CivilDate } from "@/platform/dates";
import { centsFromNumber } from "@/platform/money";
import {
  type AssetRef,
  type CoverageWindow,
  type HoldingsSnapshot,
  type KeyCheck,
  plainNumber,
  type ProviderEvent,
  type SnapshotPosition,
  SourceError,
} from "../investments/source";
import type {
  EtoroBalances,
  EtoroCashTransaction,
  EtoroHistory,
  EtoroInstrument,
  EtoroMe,
  EtoroPortfolio,
  EtoroPosition,
  EtoroTrade,
} from "./client";

const ETORO = "etoro";
/** eToro's trading account is in dollars: positions, trades and their P/L are USD. */
export const TRADING_CURRENCY = "USD";
/** The `minDate` of the trade history and the start of every flows window (spike: 2020-01-01). */
export const FLOWS_FROM: CivilDate = "2020-01-01";
/** `balances/history` refuses more than 365 days and anything past 12 months (E4, D11). */
export const HISTORY_DAYS = 360;
/** The currencies `displayCurrency` accepts (E8): the dialog offers only these. */
export const ETORO_CURRENCIES = ["EUR", "USD", "GBP", "CHF"] as const;

/** E1: read only means every scope ends with `:read`; anything else is treated as a write. */
export function keyCheckOf(me: EtoroMe): KeyCheck {
  const permissions: Record<string, boolean> = {};
  for (const scope of me.scopes) permissions[scope] = true;
  const result =
    me.scopes.length === 0
      ? "unknown-flag"
      : me.scopes.every((scope) => scope.endsWith(":read"))
        ? "read-only"
        : "write";
  return { result, permissions, ipRestricted: null, externalAccountId: String(me.gcid) };
}

/** The product of an eToro account type (E2); types the adapter does not read are `other:<type>`. */
export function productOf(accountType: string): { product: string; known: boolean } {
  const type = accountType.trim().toLowerCase();
  if (type === "trading") return { product: "trading", known: true };
  if (type === "cash") return { product: "cash", known: true };
  if (type === "crypto") return { product: "crypto", known: true };
  const slug =
    type
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 30) || "unknown";
  return { product: `other:${slug}`, known: false };
}

const CLASS_OF_TYPE: Record<number, AssetRef["class"]> = { 5: "stock", 6: "etf", 10: "crypto" };

/** An instrument as an asset: its name and symbol from the metadata, or its id when eToro gave none. */
export function instrumentAsset(id: number, instruments: ReadonlyMap<number, EtoroInstrument>): AssetRef {
  const meta = instruments.get(id);
  const symbol = (meta?.symbolFull ?? "").trim().slice(0, 20) || `ETORO-${id}`.slice(0, 20);
  const name = (meta?.instrumentDisplayName ?? "").trim().slice(0, 120) || `eToro ${id}`;
  return {
    externalId: `instrument:${id}`,
    class: CLASS_OF_TYPE[meta?.instrumentTypeID ?? -1] ?? "other",
    name,
    symbol,
    currency: TRADING_CURRENCY,
  };
}

function coinAsset(code: string, currency: string): AssetRef {
  const symbol = code.trim().toUpperCase().slice(0, 20);
  return { externalId: `coin:${symbol}`, class: "crypto", name: symbol, symbol, currency };
}

function cents(value: number): bigint {
  try {
    return centsFromNumber(value);
  } catch {
    throw new SourceError(ETORO, "schema_mismatch");
  }
}

/** Every instrument a portfolio holds, in the trading account or inside a copy (E3). */
export function portfolioInstrumentIds(portfolio: EtoroPortfolio): number[] {
  const ids = portfolio.clientPortfolio.positions.map((position) => position.instrumentID);
  for (const mirror of portfolio.clientPortfolio.mirrors) {
    for (const position of mirror.positions ?? []) ids.push(position.instrumentID);
  }
  return [...new Set(ids)].sort((a, b) => a - b);
}

/**
 * A reading (§1.6, R1, R5) from `/balances` (the total and every account, in `currency`) and the
 * portfolio with its P/L. P is eToro's own total; the positions say what it is made of. A position
 * is worth its amount plus its unrealized P/L, in dollars, at the trading account's own rate.
 */
export function holdingsOf(input: {
  balances: EtoroBalances;
  portfolio: EtoroPortfolio;
  instruments: readonly EtoroInstrument[];
  currency: string;
  observedAt: Date;
}): HoldingsSnapshot {
  const { balances, portfolio, currency } = input;
  if (balances.displayCurrency.toUpperCase() !== currency) throw new SourceError(ETORO, "schema_mismatch");
  const instruments = new Map(input.instruments.map((one) => [one.instrumentID, one]));
  const scopes = new Map<string, boolean>([
    ["trading", true],
    ["copy", true],
  ]);
  let complete = true;
  let cashCents: bigint | null = null;
  let tradingRate: number | null = null;
  const positions: SnapshotPosition[] = [];

  for (const account of balances.balances) {
    const { product, known } = productOf(account.accountType);
    if (!known) {
      scopes.set(product, false);
      if (account.displayBalance !== 0) complete = false;
      continue;
    }
    scopes.set(product, scopes.get(product) ?? true);
    if (product === "cash") cashCents = (cashCents ?? 0n) + cents(account.displayBalance);
    if (product === "trading" && account.exchangeRate && account.exchangeRate > 0) {
      tradingRate = account.exchangeRate;
    }
    if (product === "crypto" && account.balance !== 0) {
      const quantity = plainNumber(account.balance);
      positions.push({
        asset: coinAsset(account.currency, currency),
        product: "crypto",
        quantity,
        price: account.balance > 0 ? plainNumber(account.displayBalance / account.balance) : null,
        priceCurrency: currency,
        priceSource: "etoro",
        valueCents: cents(account.displayBalance),
      });
    }
  }
  if (tradingRate === null && currency === TRADING_CURRENCY) tradingRate = 1;

  const positionOf = (position: EtoroPosition, product: "trading" | "copy"): SnapshotPosition | null => {
    if (!position.units || position.units <= 0) return null;
    if (!instruments.has(position.instrumentID)) complete = false;
    const pnl = position.unrealizedPnL?.pnL;
    const value =
      position.amount === null || position.amount === undefined || pnl === null || pnl === undefined
        ? null
        : position.amount + pnl;
    const valueCents = value === null || tradingRate === null ? null : cents(value * tradingRate);
    if (valueCents === null) complete = false;
    const rate = position.unrealizedPnL?.closeRate ?? null;
    return {
      asset: instrumentAsset(position.instrumentID, instruments),
      product,
      quantity: plainNumber(position.units),
      price: rate === null ? null : plainNumber(rate),
      priceCurrency: rate === null ? null : TRADING_CURRENCY,
      priceSource: "etoro",
      valueCents,
    };
  };
  for (const position of portfolio.clientPortfolio.positions) {
    const product = position.mirrorID && position.mirrorID > 0 ? "copy" : "trading";
    const one = positionOf(position, product);
    if (one) positions.push(one);
  }
  for (const mirror of portfolio.clientPortfolio.mirrors) {
    for (const position of mirror.positions ?? []) {
      const one = positionOf(position, "copy");
      if (one) positions.push(one);
    }
  }

  const noMoney = balances.totalBalance === 0 && balances.balances.every((one) => one.displayBalance === 0);
  const empty =
    noMoney &&
    portfolio.clientPortfolio.positions.length === 0 &&
    portfolio.clientPortfolio.mirrors.length === 0;
  return {
    observedAt: input.observedAt,
    externalAccountId: String(balances.gcid),
    totalCents: cents(balances.totalBalance),
    cashCents,
    positions,
    scopes: [...scopes]
      .map(([product, done]) => ({ product, complete: done }))
      .sort((a, b) => (a.product < b.product ? -1 : 1)),
    empty,
    complete,
  };
}

function instant(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new SourceError(ETORO, "schema_mismatch");
  return date;
}

/**
 * A closed trade as two events (E4): the opening, a `buy` of the units at the open rate for what
 * was invested, and the closing, a `close` at the close rate for what came back (the investment
 * plus eToro's net profit, fees included). A copy trade is the same, in the `copy` product (E3).
 * A short keeps the same shape, with a note: eToro reports it by amount, not as units owed.
 */
export function tradeEventsOf(
  trades: readonly EtoroTrade[],
  instruments: ReadonlyMap<number, EtoroInstrument>,
): ProviderEvent[] {
  const events: ProviderEvent[] = [];
  for (const trade of trades) {
    const asset = instrumentAsset(trade.instrumentId, instruments);
    const copy = (trade.parentPositionId ?? 0) > 0 || (trade.socialTradeId ?? 0) > 0;
    const product = copy ? "copy" : "trading";
    const note = trade.isBuy ? null : "short";
    const units = trade.units > 0 ? plainNumber(trade.units) : null;
    const back = Math.max(0, trade.investment + trade.netProfit);
    events.push(
      {
        externalId: `trade:${trade.positionId}:open`,
        occurredAt: instant(trade.openTimestamp),
        note,
        legs: [
          {
            leg: "base",
            kind: "buy",
            asset,
            product,
            quantity: units,
            unitPrice: plainNumber(Math.abs(trade.openRate)),
            priceCurrency: TRADING_CURRENCY,
            nativeAmount: plainNumber(Math.abs(trade.investment)),
            nativeCurrency: TRADING_CURRENCY,
          },
        ],
      },
      {
        externalId: `trade:${trade.positionId}:close`,
        occurredAt: instant(trade.closeTimestamp),
        note,
        legs: [
          {
            leg: "base",
            kind: "close",
            asset,
            product,
            quantity: units,
            unitPrice: plainNumber(Math.abs(trade.closeRate)),
            priceCurrency: TRADING_CURRENCY,
            nativeAmount: plainNumber(back),
            nativeCurrency: TRADING_CURRENCY,
          },
        ],
      },
    );
  }
  return events;
}

/** A transfer between eToro Money and the trading platform: inside the scope, so no flow (E5). */
export function isPlatformTransfer(transaction: EtoroCashTransaction): boolean {
  return (
    transaction.transactionType === "internalTransfer" &&
    (transaction.counterparty?.name ?? "").trim().startsWith("eToro Trading Platform")
  );
}

/**
 * The movements of eToro Money as deposits and withdrawals (E5): only settled ones, and not the
 * transfers with the trading platform, which move money inside the scope of the reading.
 */
export function cashEventsOf(transactions: readonly EtoroCashTransaction[]): ProviderEvent[] {
  const events: ProviderEvent[] = [];
  for (const transaction of transactions) {
    if (transaction.status.toLowerCase() !== "settled" || isPlatformTransfer(transaction)) continue;
    const amount = transaction.amount.replace(/^-/, "");
    if (Number(amount) === 0) continue;
    events.push({
      externalId: `cash:${transaction.id}`,
      occurredAt: instant(transaction.postedAt),
      note: null,
      legs: [
        {
          leg: "main",
          kind: transaction.direction === "credit" ? "deposit" : "withdrawal",
          asset: null,
          product: null,
          quantity: null,
          unitPrice: null,
          priceCurrency: null,
          nativeAmount: amount,
          nativeCurrency: transaction.currency,
        },
      ],
    });
  }
  return events;
}

const startOf = (on: CivilDate) => new Date(`${on}T00:00:00Z`);

/**
 * What the flows cover (A7, E4, E5): the trade history is complete from {@link FLOWS_FROM};
 * the deposits only from the first movement of eToro Money — before it, money that went straight
 * to the trading account is not in the API (`before_first_movement`).
 */
export function flowsCoverage(
  transactions: readonly EtoroCashTransaction[],
  hasCashAccount: boolean,
  now: Date,
): CoverageWindow[] {
  const from = startOf(FLOWS_FROM);
  const windows: CoverageWindow[] = [
    { stream: "trades", fromAt: from, toAt: now, status: "complete", reason: null },
  ];
  const first = transactions
    .map((transaction) => instant(transaction.postedAt))
    .reduce<Date | null>((min, at) => (min === null || at < min ? at : min), null);
  if (!hasCashAccount || first === null) {
    windows.push({
      stream: "deposits",
      fromAt: from,
      toAt: now,
      status: "partial",
      reason: "before_first_movement",
    });
  } else {
    if (first > from) {
      windows.push({
        stream: "deposits",
        fromAt: from,
        toAt: first,
        status: "partial",
        reason: "before_first_movement",
      });
    }
    windows.push({ stream: "deposits", fromAt: first, toAt: now, status: "complete", reason: null });
  }
  return windows;
}

/** The first day `balances/history` is asked for: inside the 12 months of retention (D11). */
export function historyFrom(todayOn: CivilDate): CivilDate {
  return addDays(todayOn, -HISTORY_DAYS);
}

/** The daily totals of `balances/history` before today, and the 12-month limit as a declared gap. */
export function historyOf(history: EtoroHistory, currency: string, from: CivilDate, todayOn: CivilDate) {
  if (history.displayCurrency.toUpperCase() !== currency) throw new SourceError(ETORO, "schema_mismatch");
  const points = new Map<CivilDate, bigint>();
  for (const snapshot of history.snapshots) {
    if (snapshot.date < from || snapshot.date >= todayOn) continue;
    points.set(snapshot.date, cents(snapshot.displayTotalBalance));
  }
  const coverage: CoverageWindow[] = [
    {
      stream: "balance_history",
      fromAt: startOf(FLOWS_FROM),
      toAt: startOf(from),
      status: "gap",
      reason: "api_limit_12m",
    },
    {
      stream: "balance_history",
      fromAt: startOf(from),
      toAt: startOf(todayOn),
      status: "complete",
      reason: null,
    },
  ];
  return {
    points: [...points].sort(([a], [b]) => (a < b ? -1 : 1)).map(([on, totalCents]) => ({ on, totalCents })),
    coverage,
  };
}
