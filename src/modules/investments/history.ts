/**
 * The estimated history of a service whose provider has no history of its value (PERS-100, Binance):
 * the quantities of each day rebuilt backwards from the first reading through the flows, valued at
 * the exchange's daily closes. Pure, so the rule is tested without a database or a network.
 *
 * Backwards, not forwards: the line then meets the first real reading exactly, and a flow the
 * exchange never reported shows up at the far end of the history, not as a jump at the connection.
 * A quantity that comes out below zero (a stream that missed a deposit) counts as zero.
 */
import type { CivilDate } from "@/platform/dates";
import type { Cents } from "@/platform/money";
import { divRound, DUST_QUANTITY, type OperationKind, QUANTITY_SCALE } from "./rules";

/** The scale of the rates a source gives (account units per coin): the scale of its decimals. */
export const HISTORY_RATE_SCALE = 18;

/** How a leg moves its coin's quantity (A6): in for buy, deposit, income, opening; out otherwise. */
const QUANTITY_SIGN: Partial<Record<OperationKind, 1n | -1n>> = {
  opening_position: 1n,
  deposit: 1n,
  buy: 1n,
  income: 1n,
  sell: -1n,
  withdrawal: -1n,
  fee: -1n,
  close: -1n,
};

/** One operation of the account, as the history needs it. */
export interface HistoryLeg {
  on: CivilDate;
  kind: OperationKind;
  /** The coin of its holding; `null` for a leg of the account's own cash (no holding). */
  symbol: string | null;
  quantity: bigint | null;
  nativeCurrency: string | null;
  amountCents: Cents;
}

/** What a day changes: per coin, and the cash in the account's currency. */
export interface HistoryMove {
  on: CivilDate;
  symbol: string | null;
  /** A coin's quantity, or cents of cash when `symbol` is `null`. */
  delta: bigint;
}

const abs = (value: bigint) => (value < 0n ? -value : value);

/**
 * The moves of the legs (PERS-100). A coin's leg moves its quantity. The cash moves in two ways: a
 * leg with no holding is the cash itself (a SEPA deposit, its fee, the EUR side of `EUR/USDT`), in
 * by deposit, buy and income, out otherwise; a coin bought or sold against the account's currency
 * (`ETH/EUR`, a card purchase) moves the cash by its amount the other way.
 */
export function historyMoves(legs: readonly HistoryLeg[], currency: string): HistoryMove[] {
  const moves: HistoryMove[] = [];
  for (const leg of legs) {
    if (leg.symbol === null) {
      if (leg.kind === "opening_position" || leg.kind === "adjustment") continue;
      const sign = leg.kind === "deposit" || leg.kind === "buy" || leg.kind === "income" ? 1n : -1n;
      moves.push({ on: leg.on, symbol: null, delta: sign * abs(leg.amountCents) });
      continue;
    }
    const sign = QUANTITY_SIGN[leg.kind];
    if (sign !== undefined && leg.quantity !== null) {
      moves.push({ on: leg.on, symbol: leg.symbol, delta: sign * leg.quantity });
    }
    if (
      leg.nativeCurrency === currency &&
      (leg.kind === "buy" || leg.kind === "sell" || leg.kind === "close")
    ) {
      moves.push({ on: leg.on, symbol: null, delta: (leg.kind === "buy" ? -1n : 1n) * abs(leg.amountCents) });
    }
  }
  return moves;
}

export interface HistoryAnchor {
  /** The day of the first reading: every day before it is estimated, back to the first day asked. */
  on: CivilDate;
  /** The coins it reported, summed over products. */
  quantities: ReadonlyMap<string, bigint>;
  /** Its cash in the account's currency. */
  cashCents: Cents;
}

export interface EstimatedDay {
  on: CivilDate;
  totalCents: Cents;
  /** Coins held that day, over dust, with no rate on that day nor any day before it. */
  missingPrices: number;
}

/**
 * The value at the end of each of `days` (all before the anchor), oldest first: the anchor's
 * quantities minus the moves after the day, each coin at its rate of the day — or of the latest
 * day before it that had one, since a market can skip a day. `rate` is in account units per coin,
 * at {@link HISTORY_RATE_SCALE}.
 */
export function estimateHistory(input: {
  days: readonly CivilDate[];
  anchor: HistoryAnchor;
  moves: readonly HistoryMove[];
  rate: (symbol: string, on: CivilDate) => bigint | null;
}): EstimatedDay[] {
  const { anchor } = input;
  const days = [...input.days].filter((day) => day < anchor.on).sort();
  if (days.length === 0) return [];
  const quantities = new Map(anchor.quantities);
  let cash = anchor.cashCents;
  // Walk back from the anchor: a move of a later day is undone before the day is valued.
  const moves = input.moves.filter((move) => move.on <= anchor.on).sort((a, b) => (a.on < b.on ? 1 : -1));
  const values = new Map<CivilDate, { quantities: Map<string, bigint>; cash: Cents }>();
  let next = 0;
  for (const day of [...days].reverse()) {
    while (next < moves.length && moves[next].on > day) {
      const move = moves[next];
      if (move.symbol === null) cash -= move.delta;
      else quantities.set(move.symbol, (quantities.get(move.symbol) ?? 0n) - move.delta);
      next += 1;
    }
    values.set(day, { quantities: new Map(quantities), cash });
  }

  const divisor = 10n ** BigInt(QUANTITY_SCALE + HISTORY_RATE_SCALE - 2);
  const lastRate = new Map<string, bigint>();
  return days.map((day) => {
    const state = values.get(day)!;
    let total = state.cash > 0n ? state.cash : 0n;
    let missing = 0;
    for (const [symbol, quantity] of [...state.quantities].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const rate = input.rate(symbol, day) ?? lastRate.get(symbol) ?? null;
      if (rate !== null) lastRate.set(symbol, rate);
      if (quantity <= 0n) continue;
      if (rate === null) {
        if (quantity >= DUST_QUANTITY) missing += 1;
        continue;
      }
      total += divRound(quantity * rate, divisor);
    }
    return { on: day, totalCents: total, missingPrices: missing };
  });
}
