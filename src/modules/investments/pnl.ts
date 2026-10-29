// src/modules/investments/pnl.ts — the profit and loss of a period (docs/design/investments-ux.md §4,
// U1): what a service and the portfolio earned or lost between two days, split into additive parts,
// with how far the number can be trusted. Pure: no database, no clock. Amounts are bigint cents; the
// one float is a rate of return, a ratio that is never written back.
import { addDays, type CivilDate, daysBetween, isCivilDate } from "@/platform/dates";
import { convertCents, type RateTable } from "@/platform/fx/rules";
import type { Cents } from "@/platform/money";
import {
  type Book,
  compareEvents,
  divRound,
  eventsOn,
  type FlowEntry,
  flowEntriesOn,
  holdingStates,
  periodIndexOf,
  sortedPeriods,
  valueOn,
} from "./rules";
import { xirr, type Xirr } from "./xirr";

// ——— The period (§1.2, §2.1) ————————————————————————————————————————————————————————————————

export type PeriodKind = "year" | "all" | "custom";

export interface PnlPeriod {
  kind: PeriodKind;
  /** The calendar year of a `year` period. */
  year: number | null;
  /** The first day; `null` for "All": each service from its own first day. */
  from: CivilDate | null;
  /** The last day: today for the period still running, never past it. */
  to: CivilDate;
}

export interface PeriodParams {
  period?: string | null;
  from?: string | null;
  to?: string | null;
}

/**
 * The period of the URL (§1.2): `from`/`to` by day win over `period`; `period` is a year or `all`;
 * nothing, or anything else, is the year running ("2026 · year to date"). A year to come, a range
 * that ends before it starts or starts after today fall back to the default; a range that ends
 * after today stops today.
 */
export function periodOf(params: PeriodParams, todayOn: CivilDate): PnlPeriod {
  const thisYear = Number(todayOn.slice(0, 4));
  const yearOf = (year: number): PnlPeriod => {
    const end = `${year}-12-31`;
    return { kind: "year", year, from: `${year}-01-01`, to: end < todayOn ? end : todayOn };
  };
  const { from, to } = params;
  if (from && to && isCivilDate(from) && isCivilDate(to) && from <= to && from <= todayOn) {
    return { kind: "custom", year: null, from, to: to < todayOn ? to : todayOn };
  }
  if (params.period === "all") return { kind: "all", year: null, from: null, to: todayOn };
  if (params.period && /^\d{4}$/.test(params.period)) {
    const year = Number(params.period);
    if (year >= 1970 && year <= thisYear) return yearOf(year);
  }
  return yearOf(thisYear);
}

// ——— Inputs ——————————————————————————————————————————————————————————————————————————————————

/** §4.9: what a correction (R3) stands for. Until U3 stores it, every correction is `data`. */
export type AdjustmentClass = "data" | "capital" | "result";

/** A window of what a provider's flows cover (`investment_sync_coverage`, kind `flows`), by day. */
export interface CoverageWindow {
  stream: string;
  fromOn: CivilDate;
  /** The day the window ends in; a gap ending in it is closed from that day on. */
  toOn: CivilDate;
  complete: boolean;
}

export interface PnlService {
  accountId: string;
  /** `accounts.currency`: the book's amounts are in it. */
  currency: string;
  book: Book;
  /** The rates the book is valued with (`ratesFor`). */
  rates: RateTable;
  /** The flow windows of a synced service; `null` for a manual one, whose book is every flow. */
  coverage: readonly CoverageWindow[] | null;
  /** The `quantities` stream said the quantities do not add up (`quantity_mismatch`, `negative_opening`, A6). */
  quantityMismatch: boolean;
  /** The provider's id of each event (eToro `trade:<positionId>:open|close`), by event id. */
  externalIds: ReadonlyMap<string, string>;
  /** The class of each correction, by event id; missing = `data` (§4.9). */
  adjustmentClasses?: ReadonlyMap<string, AdjustmentClass>;
}

/** The display currency and the rates that convert every service into it (§4.5). */
export interface Display {
  currency: string;
  rates: RateTable;
}

// ——— Average cost and realized (§4.4) ————————————————————————————————————————————————————————

/** A quantity that left a holding, at the average cost of the moment (or the eToro position). */
export interface Exit {
  eventId: string;
  on: CivilDate;
  holdingId: string;
  kind: "sell" | "close" | "fee" | "withdrawal";
  proceedsCents: Cents;
  costCents: Cents;
  /** Proceeds − cost; `null` when more left than the book ever held, so the cost is unknown. */
  realizedCents: Cents | null;
  /** `position`: an eToro close matched with its opening by `positionId`. */
  matched: "position" | "average";
}

/** A leg of an asset moved in or out (§4.9): the value it moved at and the history it carried. */
export interface TransferRecord {
  eventId: string;
  on: CivilDate;
  holdingId: string;
  direction: "in" | "out";
  valueCents: Cents;
  /** The average cost that left with it; `null` for an asset coming in (its cost is its value). */
  historicalCostCents: Cents | null;
  transferGroupId: string | null;
}

export interface CostState {
  quantity: bigint | null;
  costCents: Cents;
}

export interface Replay {
  exits: Exit[];
  transfers: TransferRecord[];
  /** The cost of every holding at the end of `through`, in the period in force then. */
  costs: Map<string, CostState>;
}

const abs = (value: bigint) => (value < 0n ? -value : value);
const POSITION = /^trade:(.+):(open|close)$/;

/**
 * Replays the events up to `through` (§4.4): the weighted average cost of every holding, period by
 * period (a conversion starts the positions again), with the cost that leaves on each exit — the
 * number `holdingStates` throws away. The rounding is the same as `holdingStates`.
 */
export function replayHoldings(
  book: Book,
  through: CivilDate,
  externalIds: ReadonlyMap<string, string> = new Map(),
): Replay {
  const periods = sortedPeriods(book);
  const events = book.events.filter((event) => event.on <= through).sort(compareEvents);
  // eToro: what each position invested, by positionId (E4).
  const opened = new Map<string, Cents>();
  for (const event of events) {
    const match = POSITION.exec(externalIds.get(event.id) ?? "");
    if (match?.[2] !== "open") continue;
    const leg = event.operations.find((op) => op.kind === "buy");
    if (leg) opened.set(match[1], abs(leg.amountCents));
  }

  interface Running {
    quantity: bigint | null;
    /** By-value positions: the value of the last valuation, moved by buys and sells. */
    valueCents: Cents;
    costCents: Cents;
  }
  const exits: Exit[] = [];
  const transfers: TransferRecord[] = [];
  let running = new Map<string, Running>();
  let current: number | null = null;
  const stateOf = (id: string): Running => {
    let state = running.get(id);
    if (!state) {
      state = { quantity: null, valueCents: 0n, costCents: 0n };
      running.set(id, state);
    }
    return state;
  };

  for (const event of events) {
    const index = periodIndexOf(periods, event);
    if (index !== current) {
      running = new Map();
      current = index;
    }
    const position = POSITION.exec(externalIds.get(event.id) ?? "");
    for (const op of event.operations) {
      if (op.holdingId === null) continue;
      const state = stateOf(op.holdingId);
      const amount = abs(op.amountCents);
      /** Takes `quantity` (or, by value, `amount`) out at average cost; returns the cost out. */
      const takeOut = (): { cost: Cents; known: boolean } => {
        if (op.quantity === null || state.quantity === null) {
          const before = state.valueCents;
          state.valueCents -= amount;
          const after = before > 0n ? divRound(state.costCents * state.valueCents, before) : state.costCents;
          const cost = state.costCents - after;
          state.costCents = after;
          return { cost, known: before > 0n && amount <= before };
        }
        const before = state.quantity;
        const after = before - op.quantity;
        const kept =
          before > 0n ? divRound(state.costCents * (after > 0n ? after : 0n), before) : state.costCents;
        const cost = state.costCents - kept;
        state.costCents = kept;
        state.quantity = after;
        return { cost, known: before > 0n && op.quantity <= before };
      };
      const exit = (kind: Exit["kind"]) => {
        const { cost, known } = takeOut();
        exits.push({
          eventId: event.id,
          on: event.on,
          holdingId: op.holdingId!,
          kind,
          proceedsCents: amount,
          costCents: cost,
          realizedCents: known ? amount - cost : null,
          matched: "average",
        });
        return cost;
      };
      switch (op.kind) {
        case "opening_position":
        case "buy":
        case "deposit":
          state.costCents += amount;
          if (op.quantity === null) state.valueCents += amount;
          else state.quantity = (state.quantity ?? 0n) + op.quantity;
          if (op.kind === "deposit") {
            transfers.push({
              eventId: event.id,
              on: event.on,
              holdingId: op.holdingId,
              direction: "in",
              valueCents: amount,
              historicalCostCents: null,
              transferGroupId: event.transferGroupId,
            });
          }
          break;
        case "income":
          // A reward in coins is income at its value, and then the coins cost that (§4.4).
          if (op.quantity !== null) {
            state.quantity = (state.quantity ?? 0n) + op.quantity;
            state.costCents += amount;
          }
          break;
        case "valuation":
          if (op.quantity === null && op.unitPrice === null) state.valueCents = op.amountCents;
          break;
        case "sell":
          exit("sell");
          break;
        case "fee":
          // A fee paid in a coin is a sale of the coin at its value, then the fee (§4.4).
          if (op.quantity !== null) exit("fee");
          break;
        case "withdrawal": {
          const cost = exit("withdrawal");
          transfers.push({
            eventId: event.id,
            on: event.on,
            holdingId: op.holdingId,
            direction: "out",
            valueCents: amount,
            historicalCostCents: cost,
            transferGroupId: event.transferGroupId,
          });
          break;
        }
        case "close": {
          const invested = position?.[2] === "close" ? opened.get(position[1]) : undefined;
          if (invested !== undefined) {
            // eToro (§4.4): the position's own investment, not the holding's average.
            if (state.quantity !== null && op.quantity !== null) state.quantity -= op.quantity;
            state.costCents = state.costCents > invested ? state.costCents - invested : 0n;
            exits.push({
              eventId: event.id,
              on: event.on,
              holdingId: op.holdingId,
              kind: "close",
              proceedsCents: amount,
              costCents: invested,
              realizedCents: amount - invested,
              matched: "position",
            });
            break;
          }
          const cost = state.costCents;
          exits.push({
            eventId: event.id,
            on: event.on,
            holdingId: op.holdingId,
            kind: "close",
            proceedsCents: amount,
            costCents: cost,
            realizedCents: amount - cost,
            matched: "average",
          });
          state.quantity = state.quantity === null ? null : 0n;
          state.valueCents = 0n;
          state.costCents = 0n;
          break;
        }
        default:
          break;
      }
    }
  }

  // The costs of the period in force at `through`: none yet if it has no event so far.
  let inForce = -1;
  for (let index = 0; index < periods.length; index++) if (periods[index].fromOn <= through) inForce = index;
  const costs = new Map<string, CostState>();
  if (current === inForce) {
    for (const [id, state] of running)
      costs.set(id, { quantity: state.quantity, costCents: state.costCents });
  }
  return { exits, transfers, costs };
}

// ——— The P&L of a service (§4.1–§4.6) ————————————————————————————————————————————————————————

/** The additive parts of a P&L (§4.2): their sum is `pnlCents`, to the cent. */
export interface PnlParts {
  pnlCents: Cents;
  realizedCents: Cents;
  /** U(e) − U(s⁻); `null` where the positions have no cost yet: it is then in `unattributedCents`. */
  unrealizedChangeCents: Cents | null;
  incomeCents: Cents;
  /** Negative: the fees of the period. */
  feesCents: Cents;
  /** Corrections of class `data` and `result` that started or ended in the period (§4.9). */
  correctionsCents: Cents;
  /** Only in the display currency (§4.5): P&L_D − the parts converted at the rate of the last day. */
  fxCents: Cents;
  unattributedCents: Cents;
}

export type PnlStatus = "verified" | "estimated" | "undetermined";

export type PnlReason =
  /** Some day of the period stands on the rebuilt history (PERS-100). */
  | "estimated_history"
  /** The value at the start or the end used a saved rate or misses a price. */
  | "stale_price"
  /** The flows are not covered for the whole period: it starts later (`partial`) or not at all. */
  | "flows_gap"
  /** The value before the first day is unknown: the period starts at the first value known. */
  | "base_unknown"
  /** The quantities do not add up: the estimated history is no base (§4.6). */
  | "quantity_mismatch"
  /** No value on the last day: nothing to measure. */
  | "no_value"
  /** A rate to the display currency is missing. */
  | "no_rate";

export interface PeriodReturn {
  /** Modified Dietz (§4.3); `null` when the average capital is too small to divide by. */
  dietz: number | null;
  averageCapitalCents: number;
  /** XIRR over the period, only when it covers at least a year (§4.3). */
  xirr: Xirr | null;
  /** Σ |flows| is more than the capital at the start: Dietz is further from a time-weighted return. */
  largeFlows: boolean;
}

/** A flow of the period, signed (in positive), in the account's currency and the display one. */
export interface PeriodFlow {
  on: CivilDate;
  cents: Cents;
  displayCents: Cents | null;
  transferGroupId: string | null;
}

export interface HoldingPnl {
  holdingId: string;
  realizedCents: Cents;
  unrealizedChangeCents: Cents | null;
  /** Realized + the change of the unrealized: what the position added to the period (§4.2). */
  contributionCents: Cents | null;
}

export interface ServicePnl {
  accountId: string;
  currency: string;
  status: PnlStatus;
  reasons: PnlReason[];
  /** The days measured, `[from, to]` (§4.6); `from` is `null` when nothing could be. */
  from: CivilDate | null;
  to: CivilDate;
  /** The period measured starts after the one asked: the badge "from <date>". */
  partial: boolean;
  startCents: Cents | null;
  endCents: Cents | null;
  /** In the account's currency, fx zero; `null` when undetermined. */
  local: PnlParts | null;
  /** In the display currency, with the exchange effect (§4.5); `null` when a rate is missing. */
  display: PnlParts | null;
  localReturn: PeriodReturn | null;
  displayReturn: PeriodReturn | null;
  /** V(s⁻) in the display currency, at the rate of its day. */
  displayStartCents: Cents | null;
  /** The average capital of Dietz (§4.3) in the display currency; for the portfolio. */
  displayCapitalCents: number | null;
  flows: PeriodFlow[];
  exits: Exit[];
  transfers: TransferRecord[];
  holdings: HoldingPnl[];
}

/** Below this, an average capital is "almost nothing" (§4.3): 1 €, or 1 % of the gross capital. */
export const MIN_CAPITAL_CENTS = 100n;
export const MIN_CAPITAL_SHARE = 0.01;

/** The first day the book knows anything of: its first period or its first event. */
function firstDayOf(book: Book): CivilDate | null {
  const days = [...book.periods.map((period) => period.fromOn), ...book.events.map((event) => event.on)];
  return days.length === 0 ? null : days.reduce((a, b) => (a < b ? a : b));
}

/** Corrections in force at the end of `on`, of the classes asked (R3, §4.9). */
function correctionsOn(
  book: Book,
  on: CivilDate,
  classOf: (eventId: string) => AdjustmentClass,
  classes: ReadonlySet<AdjustmentClass>,
): Cents {
  let total = 0n;
  for (const event of eventsOn(book, on).events) {
    if (!classes.has(classOf(event.id))) continue;
    for (const op of event.operations) {
      if (op.kind !== "adjustment") continue;
      if (event.on <= on && (op.validUntil === null || op.validUntil >= on)) total += op.amountCents;
    }
  }
  return total;
}

const DATA_RESULT: ReadonlySet<AdjustmentClass> = new Set(["data", "result"]);

/**
 * What a period's unrealized is (§4.2): Σ (value − cost) of the open positions at the end of `on`,
 * for a manual account kept by positions; `0` before the account exists; `null` where the positions
 * have no cost (a synced account before U4) or are not kept (`total`, which has its own rule).
 */
function unrealizedOn(book: Book, on: CivilDate, rates: RateTable, replay: Replay): Cents | null | "total" {
  const periods = sortedPeriods(book);
  let index = -1;
  for (let at = 0; at < periods.length; at++) if (periods[at].fromOn <= on) index = at;
  if (index < 0) return 0n;
  const period = periods[index];
  if (period.origin !== "manual") return null;
  if (period.mode === "total") return "total";
  let total = 0n;
  for (const [holdingId, state] of holdingStates(book, on, rates)) {
    if (!state.open) continue;
    total += (state.valueCents ?? 0n) - (replay.costs.get(holdingId)?.costCents ?? 0n);
  }
  return total;
}

function unrealizedByHolding(
  book: Book,
  on: CivilDate,
  rates: RateTable,
  replay: Replay,
): Map<string, Cents> {
  const out = new Map<string, Cents>();
  for (const [holdingId, state] of holdingStates(book, on, rates)) {
    if (!state.open) continue;
    out.set(holdingId, (state.valueCents ?? 0n) - (replay.costs.get(holdingId)?.costCents ?? 0n));
  }
  return out;
}

function periodIndexAt(book: Book, on: CivilDate): number {
  const periods = sortedPeriods(book);
  let index = -1;
  for (let at = 0; at < periods.length; at++) if (periods[at].fromOn <= on) index = at;
  return index;
}

/**
 * Modified Dietz (§4.3) over `[from, to]`: flows at the end of their day, weighted by the days left.
 * `null` when the average capital is ≤ 0 or below the threshold of {@link MIN_CAPITAL_CENTS} and
 * {@link MIN_CAPITAL_SHARE} of the gross capital (the start plus the money put in).
 */
export function modifiedDietz(input: {
  from: CivilDate;
  to: CivilDate;
  startCents: Cents;
  pnlCents: Cents;
  flows: readonly { on: CivilDate; cents: Cents }[];
}): { rate: number | null; averageCapital: number; gross: number } {
  const base = addDays(input.from, -1);
  const days = daysBetween(base, input.to);
  let capital = Number(input.startCents);
  let gross = Number(input.startCents > 0n ? input.startCents : 0n);
  for (const flow of input.flows) {
    capital += (Number(flow.cents) * daysBetween(flow.on, input.to)) / days;
    if (flow.cents > 0n) gross += Number(flow.cents);
  }
  const floor = Math.max(Number(MIN_CAPITAL_CENTS), MIN_CAPITAL_SHARE * gross);
  return {
    rate: capital <= 0 || capital < floor ? null : Number(input.pnlCents) / capital,
    averageCapital: capital,
    gross,
  };
}

function returnOf(
  from: CivilDate,
  to: CivilDate,
  startCents: Cents,
  endCents: Cents,
  pnlCents: Cents,
  flows: readonly { on: CivilDate; cents: Cents }[],
): PeriodReturn {
  const dietz = modifiedDietz({ from, to, startCents, pnlCents, flows });
  const base = addDays(from, -1);
  const covered = daysBetween(base, to);
  const moved = flows.reduce((sum, flow) => sum + abs(flow.cents), 0n);
  return {
    dietz: dietz.rate,
    averageCapitalCents: dietz.averageCapital,
    xirr:
      covered >= 365
        ? xirr([
            { on: base, cents: -startCents },
            ...flows.map((flow) => ({ on: flow.on, cents: -flow.cents })),
            { on: to, cents: endCents },
          ])
        : null,
    largeFlows: moved > abs(startCents),
  };
}

const signed = (entry: FlowEntry): Cents => (entry.kind === "withdrawal" ? -entry.cents : entry.cents);

/**
 * The P&L of one service over `[s, e]` (§4): V(e) − V(s⁻) − flows, split into realized, change of
 * the unrealized, income, fees, corrections and what is left unattributed — in the account's
 * currency and in the display one with the exchange effect — measured from the first day it can be
 * trusted, with its status (§4.6) and its return (§4.3). `s = null` is "All".
 */
export function pnlOf(service: PnlService, s: CivilDate | null, e: CivilDate, display: Display): ServicePnl {
  const { book, rates } = service;
  const reasons = new Set<PnlReason>();
  const empty = (from: CivilDate | null): ServicePnl => ({
    accountId: service.accountId,
    currency: service.currency,
    status: "undetermined",
    reasons: [...reasons],
    from,
    to: e,
    partial: false,
    startCents: null,
    endCents: null,
    local: null,
    display: null,
    localReturn: null,
    displayReturn: null,
    displayStartCents: null,
    displayCapitalCents: null,
    flows: [],
    exits: [],
    transfers: [],
    holdings: [],
  });

  const asked = s ?? firstDayOf(book) ?? e;
  let from = asked;
  if (from > e) {
    reasons.add("no_value");
    return empty(null);
  }

  // The flows (§4.6): from the end of the last gap that touches the period, and never before a
  // stream starts. A gap still open on the last day leaves nothing to measure.
  if (service.coverage !== null) {
    const streams = new Set(service.coverage.map((window) => window.stream));
    if (streams.size === 0) {
      reasons.add("flows_gap");
      return empty(null);
    }
    for (const stream of streams) {
      const windows = service.coverage.filter((window) => window.stream === stream);
      const start = windows.reduce(
        (min, window) => (window.fromOn < min ? window.fromOn : min),
        windows[0].fromOn,
      );
      if (start > from) {
        from = start;
        reasons.add("flows_gap");
      }
      for (const window of windows) {
        if (window.complete || window.fromOn > e) continue;
        if (window.toOn > e) {
          reasons.add("flows_gap");
          return empty(null);
        }
        if (window.toOn > from) {
          from = window.toOn;
          reasons.add("flows_gap");
        }
      }
    }
  }

  // The rebuilt history stands on today's quantities: when they do not add up, it is no base.
  const estimatedDays = book.readings
    .filter((reading) => reading.status === "estimated")
    .map((one) => one.on);
  if (service.quantityMismatch && estimatedDays.length > 0) {
    const real = book.readings
      .filter((reading) => reading.status !== "estimated" && reading.status !== "pending_zero")
      .map((reading) => reading.on)
      .sort()[0];
    if (real === undefined || addDays(real, 1) > e) {
      reasons.add("quantity_mismatch");
      return empty(null);
    }
    if (addDays(real, 1) > from) {
      from = addDays(real, 1);
      reasons.add("quantity_mismatch");
    }
  }

  // The value before the first day: known, zero before an account whose flows hold its whole
  // history, or unknown — then the period starts after the first day with a value (never a base of 0).
  const periods = sortedPeriods(book);
  const inferredOpening = book.events.some(
    (event) => event.origin === "provider" && event.operations.some((op) => op.kind === "opening_position"),
  );
  let base = addDays(from, -1);
  let startCents = valueOn(book, base, rates).valueCents;
  if (startCents === null) {
    const before = periods.length === 0 || base < periods[0].fromOn;
    const whole = periods[0]?.origin === "manual" || (service.coverage !== null && !inferredOpening);
    if (before && whole) startCents = 0n;
    else {
      const days = [
        ...new Set([...book.readings.map((reading) => reading.on), ...book.events.map((event) => event.on)]),
      ]
        .filter((day) => day >= from && day < e)
        .sort();
      for (const day of days) {
        const value = valueOn(book, day, rates).valueCents;
        if (value !== null) {
          base = day;
          startCents = value;
          from = addDays(day, 1);
          break;
        }
      }
      reasons.add("base_unknown");
      if (startCents === null) return empty(null);
    }
  }

  const end = valueOn(book, e, rates);
  const start = valueOn(book, base, rates);
  if (end.valueCents === null) {
    reasons.add("no_value");
    return empty(from);
  }
  const endCents = end.valueCents;
  if (end.missing > 0 || start.missing > 0) reasons.add("stale_price");
  if (estimatedDays.some((day) => day >= base)) reasons.add("estimated_history");

  // The flows of [from, e], and the corrections of class `capital` as flows (§4.9).
  const classOf = (eventId: string) => service.adjustmentClasses?.get(eventId) ?? "data";
  const entries: { on: CivilDate; cents: Cents; transferGroupId: string | null }[] = flowEntriesOn(book, e)
    .filter((entry) => entry.on >= from)
    .map((entry) => ({ on: entry.on, cents: signed(entry), transferGroupId: entry.transferGroupId }));
  for (const event of book.events) {
    if (classOf(event.id) !== "capital") continue;
    for (const op of event.operations) {
      if (op.kind !== "adjustment") continue;
      if (event.on >= from && event.on <= e)
        entries.push({ on: event.on, cents: op.amountCents, transferGroupId: null });
      const ends = op.validUntil === null ? null : addDays(op.validUntil, 1);
      if (ends !== null && ends >= from && ends <= e)
        entries.push({ on: ends, cents: -op.amountCents, transferGroupId: null });
    }
  }
  entries.sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0));
  const flowCents = entries.reduce((sum, entry) => sum + entry.cents, 0n);
  const pnlCents = endCents - startCents - flowCents;

  // The parts (§4.2).
  const replayEnd = replayHoldings(book, e, service.externalIds);
  const replayStart = replayHoldings(book, base, service.externalIds);
  const exits = replayEnd.exits.filter((exit) => exit.on >= from);
  const realizedCents = exits.reduce((sum, exit) => sum + (exit.realizedCents ?? 0n), 0n);
  let incomeCents = 0n;
  let feesCents = 0n;
  for (const event of book.events) {
    if (event.on < from || event.on > e) continue;
    for (const op of event.operations) {
      if (op.kind === "income") incomeCents += op.amountCents;
      else if (op.kind === "fee") feesCents += op.amountCents;
    }
  }
  const correctionsCents =
    correctionsOn(book, e, classOf, DATA_RESULT) - correctionsOn(book, base, classOf, DATA_RESULT);

  const atEnd = unrealizedOn(book, e, rates, replayEnd);
  const atStart = unrealizedOn(book, base, rates, replayStart);
  const samePeriod = periodIndexAt(book, base) === periodIndexAt(book, e) || periodIndexAt(book, base) < 0;
  let unrealizedChangeCents: Cents | null = null;
  if (samePeriod && atEnd === "total" && (atStart === "total" || atStart === 0n)) {
    // "Value only" (§4.2): no positions — what is not income, fee or correction is the change of value.
    unrealizedChangeCents = pnlCents - realizedCents - incomeCents - feesCents - correctionsCents;
  } else if (samePeriod && typeof atEnd === "bigint" && typeof atStart === "bigint") {
    unrealizedChangeCents = atEnd - atStart;
  }
  const local: PnlParts = {
    pnlCents,
    realizedCents,
    unrealizedChangeCents,
    incomeCents,
    feesCents,
    correctionsCents,
    fxCents: 0n,
    unattributedCents:
      pnlCents - realizedCents - (unrealizedChangeCents ?? 0n) - incomeCents - feesCents - correctionsCents,
  };

  // By position: what each one added (realized + change of its unrealized).
  const byStart = samePeriod ? unrealizedByHolding(book, base, rates, replayStart) : new Map<string, Cents>();
  const byEnd = samePeriod ? unrealizedByHolding(book, e, rates, replayEnd) : new Map<string, Cents>();
  const known = typeof atEnd === "bigint" && typeof atStart === "bigint" && samePeriod;
  const ids = new Set([...exits.map((exit) => exit.holdingId), ...byStart.keys(), ...byEnd.keys()]);
  const holdings: HoldingPnl[] = [...ids].sort().map((holdingId) => {
    const realized = exits
      .filter((exit) => exit.holdingId === holdingId)
      .reduce((sum, exit) => sum + (exit.realizedCents ?? 0n), 0n);
    const change = known ? (byEnd.get(holdingId) ?? 0n) - (byStart.get(holdingId) ?? 0n) : null;
    return {
      holdingId,
      realizedCents: realized,
      unrealizedChangeCents: change,
      contributionCents: change === null ? null : realized + change,
    };
  });

  // The display currency (§4.5): V and every flow at the rate of its own day; the parts at the
  // rate of the last day; the exchange effect is the difference, rounding included.
  const toDisplay = (cents: Cents, on: CivilDate) =>
    convertCents(cents, service.currency, display.currency, on, display.rates);
  const flows: PeriodFlow[] = entries.map((entry) => ({
    ...entry,
    displayCents: toDisplay(entry.cents, entry.on),
  }));
  const endD = toDisplay(endCents, e);
  const startD = toDisplay(startCents, base);
  let displayParts: PnlParts | null = null;
  let displayReturn: PeriodReturn | null = null;
  let displayCapitalCents: number | null = null;
  if (endD === null || startD === null || flows.some((flow) => flow.displayCents === null)) {
    reasons.add("no_rate");
  } else {
    const pnlD = endD - startD - flows.reduce((sum, flow) => sum + (flow.displayCents as Cents), 0n);
    const at = (cents: Cents) => toDisplay(cents, e) as Cents;
    const parts = {
      realizedCents: at(realizedCents),
      unrealizedChangeCents: unrealizedChangeCents === null ? null : at(unrealizedChangeCents),
      incomeCents: at(incomeCents),
      feesCents: at(feesCents),
      correctionsCents: at(correctionsCents),
      unattributedCents: at(local.unattributedCents),
    };
    const converted =
      parts.realizedCents +
      (parts.unrealizedChangeCents ?? 0n) +
      parts.incomeCents +
      parts.feesCents +
      parts.correctionsCents +
      parts.unattributedCents;
    displayParts = { pnlCents: pnlD, ...parts, fxCents: pnlD - converted };
    const displayFlows = flows.map((flow) => ({ on: flow.on, cents: flow.displayCents as Cents }));
    displayReturn = returnOf(from, e, startD, endD, pnlD, displayFlows);
    displayCapitalCents = displayReturn.averageCapitalCents;
  }

  const status: PnlStatus =
    reasons.has("estimated_history") || reasons.has("stale_price") ? "estimated" : "verified";
  return {
    accountId: service.accountId,
    currency: service.currency,
    status,
    reasons: [...reasons],
    from,
    to: e,
    partial: from > asked,
    startCents,
    endCents,
    local,
    display: displayParts,
    localReturn: returnOf(from, e, startCents, endCents, pnlCents, entries),
    displayReturn,
    displayStartCents: startD,
    displayCapitalCents,
    flows,
    exits,
    transfers: replayEnd.transfers.filter((one) => one.on >= from),
    holdings,
  };
}

// ——— The portfolio (§4.6, §4.8, §4.9) ——————————————————————————————————————————————————————

export interface Contribution {
  accountId: string;
  cents: Cents;
  /** The divergent bar (§4.8): −1…1, scaled on the largest |P&L| of the rows. */
  bar: number;
  /** Share of the net P&L; `null` ("not computable") when the net is zero or almost. */
  shareOfNet: number | null;
}

export interface PortfolioPnl {
  currency: string;
  status: PnlStatus;
  /** Some service starts later, is estimated or is left out: the hero says "P&L available". */
  available: boolean;
  services: ServicePnl[];
  /** In the total: not `undetermined`, with a display amount. */
  included: string[];
  excluded: { accountId: string; reasons: PnlReason[] }[];
  partial: { accountId: string; from: CivilDate }[];
  estimated: string[];
  /** Σ services + transfers between them = P&L (§4.6). */
  parts: PnlParts | null;
  /** Both legs of a transfer inside the portfolio and the period, in the display currency (§4.9). */
  transfersCents: Cents;
  /** The aggregate Dietz, only over one range for every service (§4.8). */
  rate: number | null;
  rateReason: "ok" | "mixed_ranges" | "not_computable" | "none";
  contributions: Contribution[];
}

/**
 * The portfolio (§4.6, §4.8): the services that can be measured summed in the display currency,
 * the transfers between them closing the sum, its status down to the hero, an aggregate return only
 * when every service covers the same days, and each service's contribution in money.
 */
export function portfolioPnl(services: readonly ServicePnl[], currency: string): PortfolioPnl {
  const included = services.filter((one) => one.status !== "undetermined" && one.display !== null);
  const excluded = services
    .filter((one) => !included.includes(one))
    .map((one) => ({ accountId: one.accountId, reasons: one.reasons }));
  const partial = included
    .filter((one) => one.partial)
    .map((one) => ({ accountId: one.accountId, from: one.from! }));
  const estimated = included.filter((one) => one.status === "estimated").map((one) => one.accountId);

  // A transfer is internal when both legs are in included services, each inside its own period.
  const legs = new Map<string, { accountId: string; flow: PeriodFlow }[]>();
  for (const one of included) {
    for (const flow of one.flows) {
      if (flow.transferGroupId === null) continue;
      legs.set(flow.transferGroupId, [
        ...(legs.get(flow.transferGroupId) ?? []),
        { accountId: one.accountId, flow },
      ]);
    }
  }
  let transfersCents = 0n;
  const internal: PeriodFlow[] = [];
  for (const group of legs.values()) {
    if (new Set(group.map((leg) => leg.accountId)).size < 2) continue;
    for (const leg of group) {
      transfersCents += leg.flow.displayCents ?? 0n;
      internal.push(leg.flow);
    }
  }

  let parts: PnlParts | null = null;
  if (included.length > 0) {
    const sum = (pick: (parts: PnlParts) => Cents | null) =>
      included.reduce((total, one) => total + (pick(one.display!) ?? 0n), 0n);
    const unrealizedKnown = included.every((one) => one.display!.unrealizedChangeCents !== null);
    parts = {
      pnlCents: sum((p) => p.pnlCents) + transfersCents,
      realizedCents: sum((p) => p.realizedCents),
      unrealizedChangeCents: unrealizedKnown ? sum((p) => p.unrealizedChangeCents) : null,
      incomeCents: sum((p) => p.incomeCents),
      feesCents: sum((p) => p.feesCents),
      correctionsCents: sum((p) => p.correctionsCents),
      fxCents: sum((p) => p.fxCents),
      // A service's unknown unrealized stays in its unattributed; the transfers have their own row.
      unattributedCents:
        sum((p) => p.unattributedCents) + (unrealizedKnown ? 0n : sum((p) => p.unrealizedChangeCents)),
    };
  }

  // §4.8: one numerator and one denominator over the same days, or no aggregate rate.
  let rate: number | null = null;
  let rateReason: PortfolioPnl["rateReason"] = "none";
  if (parts !== null) {
    const ranges = new Set(included.map((one) => one.from));
    if (ranges.size > 1) rateReason = "mixed_ranges";
    else {
      const from = included[0].from!;
      const to = included[0].to;
      const days = daysBetween(addDays(from, -1), to);
      let capital = included.reduce((total, one) => total + (one.displayCapitalCents ?? 0), 0);
      for (const flow of internal)
        capital -= (Number(flow.displayCents ?? 0n) * daysBetween(flow.on, to)) / days;
      const moved = new Set(internal);
      const gross = included.reduce(
        (total, one) =>
          total +
          Math.max(0, Number(one.displayStartCents ?? 0n)) +
          one.flows
            .filter((flow) => !moved.has(flow))
            .reduce((sum, flow) => sum + Math.max(0, Number(flow.displayCents ?? 0n)), 0),
        0,
      );
      const floor = Math.max(Number(MIN_CAPITAL_CENTS), MIN_CAPITAL_SHARE * gross);
      if (capital <= 0 || capital < floor) rateReason = "not_computable";
      else {
        rate = Number(parts.pnlCents) / capital;
        rateReason = "ok";
      }
    }
  }

  // Contributions (§4.8): money first, a divergent bar, the share of the net only when it means something.
  const amounts = included.map((one) => ({ accountId: one.accountId, cents: one.display!.pnlCents }));
  const largest = amounts.reduce((max, one) => (abs(one.cents) > max ? abs(one.cents) : max), 0n);
  const gross = amounts.reduce((total, one) => total + abs(one.cents), 0n);
  const net = parts?.pnlCents ?? 0n;
  const meaningful =
    abs(net) >= MIN_CAPITAL_CENTS && Number(abs(net)) >= MIN_CAPITAL_SHARE * Number(gross) && net !== 0n;
  const contributions = amounts
    .map((one) => ({
      accountId: one.accountId,
      cents: one.cents,
      bar: largest === 0n ? 0 : Number(one.cents) / Number(largest),
      shareOfNet: meaningful ? Number(one.cents) / Number(net) : null,
    }))
    .sort((a, b) =>
      abs(a.cents) > abs(b.cents) ? -1 : abs(a.cents) < abs(b.cents) ? 1 : a.accountId < b.accountId ? -1 : 1,
    );

  const status: PnlStatus =
    included.length === 0
      ? "undetermined"
      : excluded.length === 0 && partial.length === 0 && estimated.length === 0
        ? "verified"
        : "estimated";
  return {
    currency,
    status,
    available: status !== "verified",
    services: [...services],
    included: included.map((one) => one.accountId),
    excluded,
    partial,
    estimated,
    parts,
    transfersCents,
    rate,
    rateReason,
    contributions,
  };
}
