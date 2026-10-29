// src/modules/investments/cutoff.ts — the 12 months of a synced service (PERS-145): its opening at
// the cut-off, and every difference of its cash as an entry with a name and a day, so that the P&L
// has nothing left that no part explains. Pure: no database, no clock.
import { addDays, type CivilDate } from "@/platform/dates";
import type { Cents } from "@/platform/money";
import { type Book, compareEvents, type EventLike, type OperationLike, type ReadingLike } from "./rules";

/**
 * The notes of the entries this module books (PERS-145): codes, never words — Activity says them
 * in the reader's language (`activity.ts`).
 */
export const GAP_NOTES = {
  /** The cash a service held at its cut-off. */
  opening: "cutoff_opening",
  /** A difference of the cash over a conversion between currencies: the provider's exchange cost. */
  exchange: "exchange_cost",
  /** A difference of the cash no entry explains. */
  balance: "balance_difference",
} as const;

/** The readings that count, as `valueOn` reads them (R1, R5). */
const COUNTING = new Set(["complete", "partial", "confirmed_zero", "reconstructed"]);

/**
 * What a leg moves of the account's cash, as the parts of the P&L read it (§4.2): the money of a
 * flow, a sale or a purchase of a holding against cash, and an income or a fee paid in cash. A leg
 * of a coin that is no cash (a coin's fee, a coin moved in or out, a provider's opening of a coin)
 * moves a position, never the cash; the cash side of a trade between a coin and the cash (`base`
 * with no holding) is the other leg's amount, so it does not count twice.
 */
export function cashImpact(op: OperationLike): Cents {
  const cash = op.holdingId === null;
  switch (op.kind) {
    case "deposit":
    case "withdrawal":
    case "opening_cash":
    case "income":
    case "fee":
      return cash ? op.amountCents : 0n;
    case "buy":
    case "sell":
    case "close":
      return cash ? 0n : op.amountCents;
    default:
      return 0n;
  }
}

/** The holdings a provider keeps open at the end of each event (trades in and out, A6). */
function openAfter(events: readonly EventLike[], providerHoldings: ReadonlySet<string>) {
  const quantities = new Map<string, bigint>();
  const signs: Partial<Record<OperationLike["kind"], 1n | -1n>> = {
    opening_position: 1n,
    deposit: 1n,
    buy: 1n,
    income: 1n,
    sell: -1n,
    withdrawal: -1n,
    fee: -1n,
    close: -1n,
  };
  return (event: EventLike): boolean => {
    for (const op of event.operations) {
      if (op.holdingId === null || !providerHoldings.has(op.holdingId) || op.quantity === null) continue;
      const sign = signs[op.kind];
      if (sign === undefined) continue;
      quantities.set(op.holdingId, (quantities.get(op.holdingId) ?? 0n) + sign * op.quantity);
    }
    return [...quantities.values()].some((quantity) => quantity > 0n);
  };
}

/**
 * The cash of each day read, when it is known: the provider's own figure, or — for a day of history
 * with a total only (eToro) — the whole total, when its trades leave no position open that day.
 */
export function cashByDay(book: Book): Map<CivilDate, Cents | null> {
  const providerHoldings = new Set(
    book.holdings.filter((holding) => holding.origin === "provider").map((one) => one.id),
  );
  const events = [...book.events].sort(compareEvents);
  const step = openAfter(events, providerHoldings);
  let next = 0;
  let open = false;
  const result = new Map<CivilDate, Cents | null>();
  const readings = [...book.readings]
    .filter((reading) => COUNTING.has(reading.status))
    .sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0));
  for (const reading of readings) {
    while (next < events.length && events[next].on <= reading.on) {
      open = step(events[next]);
      next += 1;
    }
    result.set(reading.on, cashOf(reading, open));
  }
  return result;
}

function cashOf(reading: ReadingLike, open: boolean): Cents | null {
  if (reading.cashCents !== null && reading.cashCents !== undefined) {
    // The cash beside positions the reading lists; a reading with no position at all is its total.
    return reading.positions.length === 0 && !open ? reading.totalCents : reading.cashCents;
  }
  if (reading.positions.length === 0 && !open) return reading.totalCents;
  return null;
}

/** A stretch of days whose cash moved by more, or less, than its entries say (PERS-145). */
export interface CashGap {
  /** The first day of the stretch (the day after the last cash known before it). */
  from: CivilDate;
  /** The last day: the entry is booked on it. */
  to: CivilDate;
  /** Positive: cash appeared that no entry brought; negative: cash went that no entry took. */
  cents: Cents;
  /** A flow booked in another currency falls in it: the difference is the provider's exchange cost. */
  exchange: boolean;
}

/**
 * The differences of the cash of a synced service, from its cut-off on (PERS-145, rule 4): between
 * two days whose cash is known, the change of the cash minus what the entries of those days moved
 * (`cashImpact`). Differences on adjacent stretches are one gap — a conversion of eToro shows up
 * over the days the money sat in the other currency — and a gap counts only once a stretch with no
 * difference follows it, so that it never closes halfway. `from` is the cut-off: the cash before
 * it is zero.
 */
export function cashGaps(book: Book, from: CivilDate): CashGap[] {
  const cash = cashByDay(book);
  const days = [...cash.keys()].filter((day) => day >= from).sort();
  const events = [...book.events].filter((event) => event.on >= from).sort(compareEvents);
  const stretches: CashGap[] = [];
  let last: { on: CivilDate; cents: Cents } = { on: addDays(from, -1), cents: 0n };
  let at = 0;
  let moved = 0n;
  let exchange = false;
  for (const day of days) {
    while (at < events.length && events[at].on <= day) {
      for (const op of events[at].operations) {
        moved += cashImpact(op);
        if (
          (op.kind === "deposit" || op.kind === "withdrawal") &&
          op.holdingId === null &&
          op.nativeCurrency &&
          op.nativeCurrency !== book.currency
        )
          exchange = true;
      }
      at += 1;
    }
    const known = cash.get(day) ?? null;
    if (known === null) continue;
    stretches.push({ from: addDays(last.on, 1), to: day, cents: known - last.cents - moved, exchange });
    last = { on: day, cents: known };
    moved = 0n;
    exchange = false;
  }

  const gaps: CashGap[] = [];
  let open: CashGap | null = null;
  for (const stretch of stretches) {
    if (stretch.cents === 0n) {
      if (open !== null && open.cents !== 0n) gaps.push(open);
      open = null;
      continue;
    }
    open =
      open === null
        ? { ...stretch }
        : {
            from: open.from,
            to: stretch.to,
            cents: open.cents + stretch.cents,
            exchange: open.exchange || stretch.exchange,
          };
  }
  return gaps;
}

/**
 * The cash a synced service opens with at its cut-off (PERS-145, rule 2), when its provider booked
 * no opening of the cash: the cash of the cut-off's reading, minus what that day's own entries
 * moved. `null` when the day's cash is unknown, or there is none.
 */
export function openingCashAt(book: Book, cutoff: CivilDate): Cents | null {
  const known = cashByDay(book).get(cutoff) ?? null;
  if (known === null) return null;
  const moved = book.events
    .filter((event) => event.on === cutoff)
    .reduce((sum, event) => sum + event.operations.reduce((one, op) => one + cashImpact(op), 0n), 0n);
  const opening = known - moved;
  return opening > 0n ? opening : null;
}
