// The value of an account on a day (§2, audit INV-3), and the `portfolio` points that project it (§1.7).
import {
  type CivilDate,
  addDays,
  lastDayOfMonth,
  monthKey,
  addMonths,
  isCivilDate,
} from "../../../shared/dates";
import { type RateTable } from "../../../platform/fx/rules";
import type { Cents } from "../../../shared/money";
import { divRound } from "../../../shared/money";
import {
  type AccountBalanceLike,
  type Book,
  type EventLike,
  eventsOn,
  type OperationLike,
  type PeriodLike,
  type ReadingLike,
  type ReconciliationLike,
  sortedPeriods,
} from "./book";
import { type HoldingState, holdingStates } from "./positions";
import {
  type AccountOrigin,
  type Mode,
  type OperationKind,
  QUANTITY_SCALE,
  type ReadingStatus,
} from "./vocabulary";

// ——— The value of a day ————————————————————————————————————————————————————————————————————

interface Conflict {
  holdingId: string;
  readingId: string;
  /** What the provider's positions of the same asset and product are worth (C, R4). */
  providerCents: Cents | null;
}

export interface DayValue {
  /** V(A,d) in the account's currency; `null` when there is nothing to tell it from yet. */
  valueCents: Cents | null;
  mode: Mode | null;
  origin: AccountOrigin | null;
  cashCents: Cents;
  assetsCents: Cents;
  /** P, C, M and R of a synced account (§2.2); zero elsewhere. */
  readingCents: Cents | null;
  conflictCents: Cents;
  manualCents: Cents;
  adjustmentCents: Cents;
  conflicts: Conflict[];
  /** Positions whose value used a saved rate, or provider positions without a price. */
  missing: number;
}

const EMPTY: DayValue = {
  valueCents: null,
  mode: null,
  origin: null,
  cashCents: 0n,
  assetsCents: 0n,
  readingCents: null,
  conflictCents: 0n,
  manualCents: 0n,
  adjustmentCents: 0n,
  conflicts: [],
  missing: 0,
};

const CASH_KINDS: ReadonlySet<OperationKind> = new Set([
  "opening_cash",
  "deposit",
  "withdrawal",
  "buy",
  "sell",
  "close",
]);

/** An operation's effect on the account's cash (§1.5): income and fees only when paid in cash. */
export function cashEffect(op: OperationLike): Cents {
  if (CASH_KINDS.has(op.kind)) return op.amountCents;
  if ((op.kind === "income" || op.kind === "fee") && op.quantity === null) return op.amountCents;
  return 0n;
}

/** R3: the adjustments in force on `on` — started, and not past their last day. */
function adjustmentsOn(events: readonly EventLike[], on: CivilDate): Cents {
  let total = 0n;
  for (const event of events) {
    for (const op of event.operations) {
      if (op.kind !== "adjustment") continue;
      if (event.on <= on && (op.validUntil === null || op.validUntil >= on)) total += op.amountCents;
    }
  }
  return total;
}

/** The reconciliation in force for a holding on `on`: the last by decorrenza, then by decision. */
export function reconciliationOn(
  reconciliations: readonly ReconciliationLike[],
  holdingId: string,
  on: CivilDate,
): ReconciliationLike | null {
  let found: ReconciliationLike | null = null;
  for (const one of reconciliations) {
    if (one.holdingId !== holdingId || one.effectiveOn > on) continue;
    if (
      found === null ||
      one.effectiveOn > found.effectiveOn ||
      (one.effectiveOn === found.effectiveOn && one.decidedAt.getTime() > found.decidedAt.getTime())
    ) {
      found = one;
    }
  }
  return found;
}

/** The readings that count (R1, R5): a `pending_zero` waits for the person's answer. */
const COUNTING: ReadonlySet<ReadingStatus> = new Set([
  "complete",
  "partial",
  "confirmed_zero",
  "reconstructed",
]);

/** Dust (B5): under 0.001 units, too little for any market to price. */
export const DUST_QUANTITY = 10n ** BigInt(QUANTITY_SCALE - 3);

/**
 * A position no market priced and too small to matter (B5, PERS-100: 0.0000765 ETHW in Funding):
 * shown as dust, never counted as a missing price.
 */
export function isUnpricedDust(position: { valueCents: Cents | null; quantity?: bigint | null }): boolean {
  return (
    position.valueCents === null &&
    position.quantity !== null &&
    position.quantity !== undefined &&
    position.quantity < DUST_QUANTITY
  );
}

/** The prices a reading misses: its unpriced positions, dust left out. */
export function missingPricesOf(
  positions: readonly { valueCents: Cents | null; quantity?: bigint | null }[],
): number {
  return positions.filter((position) => position.valueCents === null && !isUnpricedDust(position)).length;
}

/** The reading in force at the end of `on` inside `period`: the last one that counts (R1, R5). */
function readingIn(book: Book, period: PeriodLike, on: CivilDate): ReadingLike | null {
  return (
    book.readings
      .filter((one) => one.on >= period.fromOn && one.on <= on && COUNTING.has(one.status))
      .sort((a, b) => (a.on < b.on ? 1 : a.on > b.on ? -1 : 0))[0] ?? null
  );
}

/** The reading a synced account's value stands on at the end of `on`; `null` for a manual period. */
export function readingOn(book: Book, on: CivilDate): ReadingLike | null {
  const { period } = eventsOn(book, on);
  if (period === null || period.origin === "manual") return null;
  return readingIn(book, period, on);
}

/** The last row of `balances` on or before `on`; `null` before the first. */
function balanceAt(balances: readonly AccountBalanceLike[], on: CivilDate): AccountBalanceLike | null {
  let found: AccountBalanceLike | null = null;
  for (const one of balances) {
    if (one.on > on) break;
    found = one;
  }
  return found;
}

/**
 * V(A,d) (§2): the value of the account at the end of `on`, in its currency — the one value of a
 * service (audit INV-3). The hero, the KPIs, `/api/v1/investments`, the MCP and the P&L read it on
 * the book; the `portfolio` balances Accounts, Overview and `GET /summary` read are its projection,
 * written by `rebuild` through {@link computePoints}.
 *
 * - manual, `assets`: cash + Σ positions (§2.1);
 * - manual, `total`: the last account valuation + the net flows after it, never below zero;
 *   unknown (`null`) while money went in before any valuation (§2.1, the legacy rule);
 * - synced: P − C + M + R (§2.2, R1–R6).
 *
 * Adjustments (R3) apply in every mode. Only the events of the period in force count (A3).
 */
export function valueAt(book: Book, on: CivilDate, rates: RateTable): DayValue {
  const { period, events } = eventsOn(book, on);
  if (period === null) return EMPTY;
  const adjustmentCents = adjustmentsOn(events, on);

  const byBalance = book.balancesUntil === undefined || on < book.balancesUntil;
  if (period.origin === "manual" && book.accountBalances !== undefined && byBalance) {
    // A manual service is a view on its account (§1.3, PERS-342): V is the account's balance.
    const balance = balanceAt(book.accountBalances, on);
    return {
      ...EMPTY,
      mode: "total",
      origin: "manual",
      valueCents: balance === null ? null : balance.cents,
    };
  }

  if (period.origin === "manual" && period.mode === "total") {
    // The rule of the legacy `valueOn` (§2.1): unknown — never zero — while money has gone in and
    // nobody has valued the account yet; zero when nothing has happened; never below zero.
    let base: Cents | null = null;
    let after = 0n;
    let flows = false;
    for (const event of events) {
      for (const op of event.operations) {
        if (op.kind === "account_valuation") {
          base = op.amountCents;
          after = 0n;
        } else if (op.kind === "deposit" || op.kind === "withdrawal") {
          after += op.amountCents;
          flows = true;
        }
      }
    }
    if (base === null && flows) return { ...EMPTY, mode: "total", origin: "manual", adjustmentCents };
    const held = (base ?? 0n) + after;
    return {
      ...EMPTY,
      mode: "total",
      origin: "manual",
      valueCents: (held < 0n ? 0n : held) + adjustmentCents,
      adjustmentCents,
    };
  }

  const states = holdingStates(book, on, rates);
  const byId = new Map(book.holdings.map((holding) => [holding.id, holding]));
  let missing = 0;
  const valueOf = (state: HoldingState) => {
    if (state.staleRate) missing += 1;
    return state.valueCents ?? 0n;
  };

  if (period.origin === "manual") {
    let cashCents = 0n;
    for (const event of events) for (const op of event.operations) cashCents += cashEffect(op);
    let assetsCents = 0n;
    for (const state of states.values()) if (state.open) assetsCents += valueOf(state);
    return {
      ...EMPTY,
      mode: "assets",
      origin: "manual",
      valueCents: cashCents + assetsCents + adjustmentCents,
      cashCents,
      assetsCents,
      adjustmentCents,
      missing,
    };
  }

  // Synced: P − C + M + R.
  const reading = readingIn(book, period, on);
  if (reading === null) return { ...EMPTY, mode: period.mode, origin: "synced", adjustmentCents };
  missing += missingPricesOf(reading.positions);

  let manualCents = 0n;
  let conflictCents = 0n;
  const conflicts: Conflict[] = [];
  for (const [holdingId, state] of states) {
    const holding = byId.get(holdingId);
    if (!holding || holding.origin !== "manual" || !state.open) continue;
    const value = valueOf(state);
    const decided = reconciliationOn(book.reconciliations, holdingId, on);
    const kind = decided?.kind ?? null;
    if (kind === "covered_by_provider") continue;
    if (kind === "partial" && decided?.quantity !== null && decided?.quantity !== undefined) {
      const covered =
        state.quantity !== null && state.quantity > 0n
          ? divRound(
              value * (decided.quantity < state.quantity ? decided.quantity : state.quantity),
              state.quantity,
            )
          : 0n;
      manualCents += value - covered;
      continue;
    }
    manualCents += value;
    if (kind === "outside_scope") continue;
    const covers = reading.scopes.some((scope) => scope.product === holding.product);
    if (!covers) continue;
    const matching = reading.positions.filter(
      (position) => position.assetId === holding.assetId && position.product === holding.product,
    );
    const priced = matching.every((position) => position.valueCents !== null);
    const providerCents = matching.reduce<Cents>(
      (total, position) => total + (position.valueCents ?? 0n),
      0n,
    );
    conflictCents += providerCents;
    conflicts.push({ holdingId, readingId: reading.id, providerCents: priced ? providerCents : null });
  }
  return {
    ...EMPTY,
    mode: period.mode,
    origin: "synced",
    valueCents: reading.totalCents - conflictCents + manualCents + adjustmentCents,
    readingCents: reading.totalCents,
    conflictCents,
    manualCents,
    adjustmentCents,
    conflicts,
    missing,
  };
}

// ——— Points ————————————————————————————————————————————————————————————————————————————————

interface Point {
  on: CivilDate;
  cents: Cents;
}

/**
 * The days that get a `portfolio` point (§1.7): every day with an event, a reading, a
 * reconciliation or a period start, the day after an adjustment ends, and the last day of every
 * month — from the first period to `today`, never past it.
 */
export function pointDays(book: Book, today: CivilDate): CivilDate[] {
  const periods = sortedPeriods(book);
  if (periods.length === 0) return [];
  const first = periods[0].fromOn;
  const days = new Set<CivilDate>();
  for (const period of periods) days.add(period.fromOn);
  for (const event of book.events) {
    days.add(event.on);
    for (const op of event.operations) if (op.validUntil !== null) days.add(addDays(op.validUntil, 1));
  }
  for (const reading of book.readings) days.add(reading.on);
  for (const one of book.reconciliations) days.add(one.effectiveOn);
  for (let month = monthKey(first); ; month = addMonths(month, 1)) {
    const end = lastDayOfMonth(month);
    if (end > today) break;
    days.add(end);
  }
  return [...days].filter((day) => day >= first && day <= today).sort();
}

/**
 * The `portfolio` points of an account (§1.7): V on every point day from `from` on. A day with no
 * value (a synced period before its first reading) gets no point, so the balance before it holds.
 * Deterministic: the same book gives the same points, and a day before `from` is never looked at,
 * so rewriting from `from` leaves every earlier day as it was.
 */
export function computePoints(book: Book, rates: RateTable, today: CivilDate, from?: CivilDate): Point[] {
  const points: Point[] = [];
  for (const on of pointDays(book, today)) {
    if (from !== undefined && on < from) continue;
    const value = valueAt(book, on, rates).valueCents;
    if (value !== null) points.push({ on, cents: value });
  }
  return points;
}

/** The oldest day a change touches: rewriting starts there (§1.7). */
export function oldestDay(...days: readonly (CivilDate | null | undefined)[]): CivilDate | null {
  const known = days.filter((day): day is CivilDate => typeof day === "string" && isCivilDate(day));
  return known.length === 0 ? null : known.reduce((a, b) => (a < b ? a : b));
}
