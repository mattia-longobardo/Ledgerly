// src/modules/investments/pnl.ts — the profit and loss of a period (docs/design/investments-ux.md §4,
// U1): what a service and the portfolio earned or lost between two days, split into additive parts,
// with how far the number can be trusted. Pure: no database, no clock. Amounts are bigint cents; the
// one float is a rate of return, a ratio that is never written back.
import { addDays, type CivilDate, daysBetween, isCivilDate } from "@/platform/dates";
import { convertCents, type RateTable } from "@/platform/fx/rules";
import type { Cents } from "@/platform/money";
import {
  type AdjustmentClass,
  type Book,
  compareEvents,
  divRound,
  eventsOn,
  type FlowEntry,
  flowEntriesOn,
  holdingStates,
  isUnpricedDust,
  periodIndexOf,
  type ReadingLike,
  readingOn,
  reconciliationOn,
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

/** §4.9: what a correction (R3) stands for; stored on its leg since U3, `data` when unset. */
export type { AdjustmentClass };

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
  /** The day the quantity that left went in: the eToro opening, or the first buy since the holding was last empty. */
  openedOn: CivilDate | null;
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
  /** A by-value position (no quantity): its value at the last valuation, moved by buys and sells. */
  valueCents?: Cents;
  /** The first entry since the holding was last empty. */
  since?: CivilDate | null;
}

/**
 * Where a period's replay starts (PERS-145): the end of `on` (s⁻), each holding open then with its
 * quantity and, as its cost, its value that day — the basis of the period (§4.4).
 */
export interface ReplayStart {
  on: CivilDate;
  states: ReadonlyMap<string, CostState>;
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
  start?: ReplayStart,
): Replay {
  const periods = sortedPeriods(book);
  const events = book.events
    .filter((event) => event.on <= through && (start === undefined || event.on > start.on))
    .sort(compareEvents);
  // eToro: what each position invested, by positionId (E4), and when it opened.
  const opened = new Map<string, { cents: Cents; on: CivilDate }>();
  for (const event of events) {
    const match = POSITION.exec(externalIds.get(event.id) ?? "");
    if (match?.[2] !== "open") continue;
    const leg = event.operations.find((op) => op.kind === "buy");
    if (leg) opened.set(match[1], { cents: abs(leg.amountCents), on: event.on });
  }

  interface Running {
    quantity: bigint | null;
    /** By-value positions: the value of the last valuation, moved by buys and sells. */
    valueCents: Cents;
    costCents: Cents;
    /** The first entry since the holding was last empty. */
    since: CivilDate | null;
  }
  const exits: Exit[] = [];
  const transfers: TransferRecord[] = [];
  let running = new Map<string, Running>();
  let current: number | null = null;
  if (start !== undefined) {
    // The period's basis: what was open at s⁻, at its value of that day (§4.4, PERS-145).
    current = periodIndexAt(book, start.on);
    for (const [id, state] of start.states) {
      running.set(id, {
        quantity: state.quantity,
        valueCents: state.valueCents ?? state.costCents,
        costCents: state.costCents,
        since: state.since ?? null,
      });
    }
  }
  const stateOf = (id: string): Running => {
    let state = running.get(id);
    if (!state) {
      state = { quantity: null, valueCents: 0n, costCents: 0n, since: null };
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
          openedOn: state.since,
        });
        if (state.quantity === null ? state.valueCents <= 0n : state.quantity <= 0n) state.since = null;
        return cost;
      };
      const enter = () => {
        const empty = state.quantity === null ? state.valueCents <= 0n : state.quantity <= 0n;
        if (empty || state.since === null) state.since = event.on;
      };
      switch (op.kind) {
        case "opening_position":
        case "buy":
        case "deposit":
          enter();
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
            enter();
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
            state.costCents = state.costCents > invested.cents ? state.costCents - invested.cents : 0n;
            exits.push({
              eventId: event.id,
              on: event.on,
              holdingId: op.holdingId,
              kind: "close",
              proceedsCents: amount,
              costCents: invested.cents,
              realizedCents: amount - invested.cents,
              matched: "position",
              openedOn: invested.on,
            });
            if (state.quantity !== null && state.quantity <= 0n) state.since = null;
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
            openedOn: state.since,
          });
          state.quantity = state.quantity === null ? null : 0n;
          state.valueCents = 0n;
          state.costCents = 0n;
          state.since = null;
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
      costs.set(id, {
        quantity: state.quantity,
        costCents: state.costCents,
        valueCents: state.valueCents,
        since: state.since,
      });
  }
  return { exits, transfers, costs };
}

// ——— The P&L of a service (§4.1–§4.6) ————————————————————————————————————————————————————————

/** The additive parts of a P&L (§4.2): their sum is `pnlCents`, to the cent. */
export interface PnlParts {
  pnlCents: Cents;
  /** Sales against the period's basis (§4.4), and what is left of a position closed below 1 € (dust). */
  realizedCents: Cents;
  /**
   * The unrealized of the positions open at e against the period's basis (PERS-145): zero when
   * none is open; `null` only where the positions of a day are unknown (then in `unattributedCents`).
   */
  unrealizedChangeCents: Cents | null;
  incomeCents: Cents;
  /** Negative: the fees of the period. */
  feesCents: Cents;
  /** Corrections of class `data` and `result` that started or ended in the period (§4.9). */
  correctionsCents: Cents;
  /** Only in the display currency (§4.5): P&L_D − the parts converted at the rate of the last day. */
  fxCents: Cents;
  /** What no part explains: zero on consistent data (PERS-145), never shown as a part of its own. */
  unattributedCents: Cents;
}

/** `stale`: a price or a rate of the first or the last day is an old one (§4.6). */
export type PnlStatus = "verified" | "stale" | "undetermined";

export type PnlReason =
  /** The value at the start or the end used a saved rate or misses a price. */
  | "stale_price"
  /** The flows are not covered for the whole period: it starts later (`partial`) or not at all. */
  | "flows_gap"
  /** The value before the first day is unknown: the period starts at the first value known. */
  | "base_unknown"
  /** No value on the last day: nothing to measure. */
  | "no_value"
  /** A rate to the display currency is missing. */
  | "no_rate";

export interface PeriodReturn {
  /**
   * The period's return (§4.3): Modified Dietz; when it has no average capital to divide by — the
   * money went in and out inside the period, profit included (eToro 2026) — the P&L on the money
   * put in (PERS-145, `method: "invested"`). `null` when there is no capital at all.
   */
  dietz: number | null;
  method: "dietz" | "invested";
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
  /** The currency it was booked in, when the provider converted it (eToro Money in EUR). */
  converted?: string | null;
}

export interface HoldingPnl {
  /** {@link PositionAt.key}: the holding, or the provider's asset and product. */
  key: string;
  holdingId: string | null;
  assetId: string | null;
  product: string | null;
  realizedCents: Cents;
  /** U(e) − U(s⁻) of this position; `null` when its cost is unknown at either end. */
  unrealizedChangeCents: Cents | null;
  /** Realized + the change of the unrealized: what the position added to the period (§4.2). */
  contributionCents: Cents | null;
  /** Open at e (dust left out, PERS-145). */
  open: boolean;
  /** Some of it left in the period: a sale, a close, a coin fee, a transfer out. */
  sold: boolean;
  /** The position at the end of `s⁻` and at the end of `e`; `null` when it was not open then. */
  start: PositionAt | null;
  end: PositionAt | null;
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
  /** The cash beside the positions on the last day (§3.4); `null` when the provider does not say it. */
  endCashCents: Cents | null;
  /** The positions open at e (dust left out): without one, the period has no unrealized (PERS-145). */
  openPositions: number;
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

/**
 * The first day `t` of the stretch ending on `end` in which no money can have moved although the
 * flows are not covered (PERS-119): the provider read the value every day from `t − 1` to `end`,
 * always the same, and the book has no event in `[t, end]` — a deposit or a withdrawal would have
 * moved the value, and one in and out on the same day changes no P&L. `end + 1` when there is none.
 */
export function flatSince(book: Book, end: CivilDate): CivilDate {
  const totals = new Map<CivilDate, Cents>();
  for (const reading of book.readings) {
    if (reading.status === "pending_zero") continue;
    totals.set(reading.on, reading.totalCents);
  }
  const booked = new Set(book.events.map((event) => event.on));
  const value = totals.get(end);
  let start = addDays(end, 1);
  if (value === undefined) return start;
  for (let day = end; ; day = addDays(day, -1)) {
    const before = totals.get(addDays(day, -1));
    if (booked.has(day) || before === undefined || before !== value) return start;
    start = day;
  }
}

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

// ——— The positions of a day (§3.4, §4.2, §4.7, U4) ————————————————————————————————————————————

/**
 * Where a position's cost comes from (§4.7): the replay of its events (a manual position, a Binance
 * coin whose trades add up to the quantity read), the provider itself (eToro's invested `amount`),
 * or a later reading of the same quantity whose provider said it — the average cost of a position
 * moves only with its quantity. `period`: the basis of a period (PERS-145), its value at s⁻ or what
 * it cost when bought in the period.
 */
export type CostSource = "events" | "provider" | "inferred" | "period";

export interface PositionAt {
  /** The holding's id; a provider position no event ever touched is `asset:<assetId>:<product>`. */
  key: string;
  holdingId: string | null;
  assetId: string | null;
  product: string | null;
  origin: "manual" | "provider";
  quantity: bigint | null;
  unitPrice: bigint | null;
  priceCurrency: string | null;
  /** In the account's currency; `null` for a position no market priced. */
  valueCents: Cents | null;
  /** At average cost, in the account's currency; `null` when nothing says it (§4.7). */
  costCents: Cents | null;
  costSource: CostSource | null;
  /** value − cost; `null` without either. */
  unrealizedCents: Cents | null;
}

export interface PositionsAt {
  /**
   * `total`: a manual account kept by value only, which has no positions; `none`: no period yet;
   * `unknown`: the reading in force says a total and nothing of what it holds (a day of eToro's
   * history, an estimated Binance day): its provider positions are unknown, never absent.
   */
  kind: "positions" | "total" | "none" | "unknown";
  positions: PositionAt[];
  /** The cash of the day: the reading's for a synced account, the book's for a manual one. */
  cashCents: Cents | null;
}

/** Two quantities read and replayed are the same one: equal to a millionth (exchange rounding). */
function sameQuantity(replayed: bigint | null, read: bigint | null): boolean {
  if (replayed === null || read === null || read <= 0n) return false;
  return abs(replayed - read) * 1_000_000n <= read;
}

interface ReadGroup {
  assetId: string;
  product: string;
  quantity: bigint | null;
  unitPrice: bigint | null;
  priceCurrency: string | null;
  valueCents: Cents | null;
  /** Σ of the costs the provider gave; `null` when one of them is missing. */
  costCents: Cents | null;
}

/** A reading's positions by asset and product (eToro has a row per trade), dust left out (V4). */
function groupsOf(positions: ReadingLike["positions"], skip: ReadonlySet<string>): Map<string, ReadGroup> {
  const groups = new Map<string, ReadGroup>();
  for (const one of positions) {
    if (isUnpricedDust(one)) continue;
    const key = `${one.assetId}|${one.product}`;
    if (skip.has(key)) continue;
    const quantity = one.quantity ?? null;
    const cost = one.costCents ?? null;
    const group = groups.get(key);
    if (!group) {
      groups.set(key, {
        assetId: one.assetId,
        product: one.product,
        quantity,
        unitPrice: one.unitPrice ?? null,
        priceCurrency: one.priceCurrency ?? null,
        valueCents: one.valueCents,
        costCents: cost,
      });
      continue;
    }
    group.quantity = group.quantity === null || quantity === null ? null : group.quantity + quantity;
    group.valueCents =
      group.valueCents === null || one.valueCents === null ? null : group.valueCents + one.valueCents;
    group.costCents = group.costCents === null || cost === null ? null : group.costCents + cost;
  }
  return groups;
}

/**
 * The open positions at the end of `on` (§3.4), each with its value and its cost: a manual
 * account's from its events; a synced one's from the reading in force, the manual positions it
 * counts next to it, and a cost from the provider, from the replayed events when they add up to the
 * quantity read, or from a later reading of the same quantity (§4.7). A cost nothing says is `null`:
 * that position's unrealized stays in "Other (incomplete data)".
 */
export function positionsOn(book: Book, on: CivilDate, rates: RateTable, replay: Replay): PositionsAt {
  const periods = sortedPeriods(book);
  const index = periodIndexAt(book, on);
  if (index < 0) return { kind: "none", positions: [], cashCents: null };
  const period = periods[index];
  if (period.origin === "manual" && period.mode === "total") {
    return { kind: "total", positions: [], cashCents: null };
  }
  const states = holdingStates(book, on, rates);
  const byId = new Map(book.holdings.map((holding) => [holding.id, holding]));
  const positions: PositionAt[] = [];
  const day = valueOn(book, on, rates);
  const conflicted = new Set(day.conflicts.map((conflict) => conflict.holdingId));
  const replaced = new Set<string>();

  for (const [holdingId, state] of states) {
    const holding = byId.get(holdingId);
    if (!state.open || !holding) continue;
    // A synced account's provider holdings are its trades: the reading says what is open (A6).
    if (period.origin !== "manual" && holding.origin !== "manual") continue;
    let valueCents = state.valueCents ?? 0n;
    let costCents: Cents | null = replay.costs.get(holdingId)?.costCents ?? 0n;
    if (period.origin !== "manual") {
      const decided = reconciliationOn(book.reconciliations, holdingId, on);
      if (decided?.kind === "covered_by_provider") continue;
      if (decided?.kind === "partial" && decided.quantity !== null) {
        // Only the part the provider does not cover counts; its cost is not split (R4).
        const covered =
          state.quantity !== null && state.quantity > 0n
            ? divRound(
                valueCents * (decided.quantity < state.quantity ? decided.quantity : state.quantity),
                state.quantity,
              )
            : 0n;
        valueCents -= covered;
        costCents = null;
      }
      if (conflicted.has(holdingId)) replaced.add(`${holding.assetId}|${holding.product}`);
    }
    positions.push({
      key: holdingId,
      holdingId,
      assetId: holding.assetId,
      product: holding.product,
      origin: holding.origin,
      quantity: state.quantity,
      unitPrice: state.unitPrice,
      priceCurrency: state.priceCurrency,
      valueCents,
      costCents,
      costSource: costCents === null ? null : "events",
      unrealizedCents: costCents === null ? null : valueCents - costCents,
    });
  }
  if (period.origin === "manual") return { kind: "positions", positions, cashCents: day.cashCents };

  const reading = readingOn(book, on);
  if (reading === null) return { kind: "positions", positions, cashCents: null };
  if (reading.positions.length === 0 && (reading.cashCents ?? null) === null && reading.totalCents !== 0n) {
    // A day of history with a total only (eToro): all cash when the service books its trades and
    // they leave nothing open that day.
    const trades = book.events.some(
      (event) => event.origin === "provider" && event.operations.some((op) => op.holdingId !== null),
    );
    const open =
      !trades ||
      book.holdings.some((holding) => {
        if (holding.origin !== "provider") return false;
        const state = replay.costs.get(holding.id);
        return (
          state !== undefined &&
          (state.quantity === null ? (state.valueCents ?? 0n) > 0n : state.quantity > 0n)
        );
      });
    if (open) return { kind: "unknown", positions, cashCents: null };
    return { kind: "positions", positions, cashCents: reading.totalCents };
  }
  const providerHolding = new Map(
    book.holdings
      .filter((holding) => holding.origin === "provider")
      .map((holding) => [`${holding.assetId}|${holding.product}`, holding.id]),
  );
  const later = book.readings
    .filter((one) => one.on > reading.on && one.on >= period.fromOn)
    .filter((one) => one.positions.some((position) => position.costCents != null))
    .sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0))
    .map((one) => groupsOf(one.positions, replaced));
  for (const [key, group] of groupsOf(reading.positions, replaced)) {
    const holdingId = providerHolding.get(key) ?? null;
    let costCents = group.costCents;
    let costSource: CostSource | null = costCents === null ? null : "provider";
    if (costCents === null && holdingId !== null) {
      const replayed = replay.costs.get(holdingId);
      if (replayed && sameQuantity(replayed.quantity, group.quantity)) {
        costCents = replayed.costCents;
        costSource = "events";
      }
    }
    if (costCents === null) {
      for (const groups of later) {
        const next = groups.get(key);
        if (!next || next.costCents === null) continue;
        if (next.quantity !== null && next.quantity === group.quantity) {
          costCents = next.costCents;
          costSource = "inferred";
        }
        break;
      }
    }
    positions.push({
      key: holdingId ?? `asset:${key.replace("|", ":")}`,
      holdingId,
      assetId: group.assetId,
      product: group.product,
      origin: "provider",
      quantity: group.quantity,
      unitPrice: group.unitPrice,
      priceCurrency: group.priceCurrency,
      valueCents: group.valueCents,
      costCents,
      costSource,
      unrealizedCents: costCents === null || group.valueCents === null ? null : group.valueCents - costCents,
    });
  }
  return { kind: "positions", positions, cashCents: reading.cashCents ?? null };
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
  // Money put in before the last day (an opening on the last day is no capital yet, §4.3).
  const putIn = startCents > 0n || flows.some((flow) => flow.cents > 0n && flow.on < to);
  const invested = dietz.rate === null && putIn && dietz.gross >= Number(MIN_CAPITAL_CENTS);
  return {
    dietz: invested ? Number(pnlCents) / dietz.gross : dietz.rate,
    method: invested ? "invested" : "dietz",
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

/** Under this value a provider's position is dust (PERS-145): no open position, no unrealized. */
export const OPEN_MIN_CENTS = 100n;

const sumOf = (map: ReadonlyMap<string, Cents>): Cents =>
  [...map.values()].reduce((sum, one) => sum + one, 0n);

/**
 * The cut-off of a synced service (PERS-145): the first day of its first period, when its
 * provider's opening is booked on that day — what it held then, at that day's close, is a flow in.
 * `null` for a manual service, or a synced one with no such opening.
 */
export function cutoffOf(book: Book): CivilDate | null {
  const first = sortedPeriods(book)[0];
  if (!first || first.origin === "manual") return null;
  const opened = book.events.some(
    (event) =>
      event.origin === "provider" &&
      event.on === first.fromOn &&
      event.operations.some((op) => op.kind === "opening_cash" || op.kind === "opening_position"),
  );
  return opened ? first.fromOn : null;
}

/** The key a position is measured by: a provider's coin across its products, a manual holding alone. */
function groupKey(position: Pick<PositionAt, "origin" | "assetId" | "key">): string {
  return position.origin === "provider" && position.assetId !== null
    ? `asset:${position.assetId}`
    : position.key;
}

/** The positions of a day by {@link groupKey}: a provider's coin in spot and in Earn is one. */
function groupPositions(positions: readonly PositionAt[]): Map<string, PositionAt> {
  const groups = new Map<string, PositionAt>();
  const add = (a: bigint | null, b: bigint | null) => (a === null ? b : b === null ? a : a + b);
  for (const one of positions) {
    const key = groupKey(one);
    const group = groups.get(key);
    if (!group) {
      groups.set(key, { ...one, key });
      continue;
    }
    const valueCents = add(group.valueCents, one.valueCents);
    const costCents =
      group.costCents === null || one.costCents === null ? null : group.costCents + one.costCents;
    groups.set(key, {
      ...group,
      holdingId: group.holdingId ?? one.holdingId,
      product: group.product === one.product ? group.product : null,
      quantity: group.quantity === null || one.quantity === null ? null : group.quantity + one.quantity,
      valueCents,
      costCents,
      unrealizedCents: costCents === null || valueCents === null ? null : valueCents - costCents,
    });
  }
  return groups;
}

/** A position still open at the end of a day: a manual one, or a provider's worth at least 1 €. */
function isOpen(position: PositionAt): boolean {
  if (position.origin === "manual") return true;
  if (position.valueCents === null) return !isUnpricedDust(position);
  return position.valueCents >= OPEN_MIN_CENTS;
}

/**
 * The basis of a period (§4.4, PERS-145): every holding open at s⁻ with its quantity and, as its
 * cost, its value that day — a provider's coin split over its holdings by quantity, a holding the
 * day does not show at zero (it is not in V(s⁻) either). The value of a position no event ever
 * touched stays by asset (`unheld`). Where the positions of s⁻ are unknown, every holding keeps the
 * cost it had.
 */
function basisOf(
  book: Book,
  at: PositionsAt,
  replay: Replay,
): { states: Map<string, CostState>; unheld: Map<string, Cents> } {
  const states = new Map<string, CostState>();
  for (const [id, state] of replay.costs) states.set(id, { ...state });
  const unheld = new Map<string, Cents>();
  if (at.kind !== "positions") return { states, unheld };
  const holdingOf = new Map(book.holdings.map((holding) => [holding.id, holding]));
  const members = new Map<string, string[]>();
  for (const [id, state] of states) {
    const holding = holdingOf.get(id);
    if (!holding) continue;
    const open = state.quantity === null ? (state.valueCents ?? 0n) > 0n : state.quantity > 0n;
    if (!open) continue;
    const key = holding.origin === "provider" ? `asset:${holding.assetId}` : id;
    members.set(key, [...(members.get(key) ?? []), id]);
  }
  const values = groupPositions(at.positions);
  for (const [key, ids] of members) {
    const cents = values.get(key)?.valueCents ?? 0n;
    const weights = ids.map((id) => {
      const state = states.get(id)!;
      return state.quantity ?? state.valueCents ?? 0n;
    });
    const total = weights.reduce((sum, one) => sum + one, 0n);
    let left = cents;
    ids.forEach((id, index) => {
      const share =
        index === ids.length - 1 ? left : total > 0n ? divRound(cents * weights[index], total) : 0n;
      left -= share;
      const state = states.get(id)!;
      states.set(id, {
        ...state,
        costCents: share,
        valueCents: state.quantity === null ? share : state.valueCents,
      });
    });
  }
  for (const [key, position] of values) {
    if (members.has(key)) continue;
    const cents = position.valueCents ?? 0n;
    if (cents !== 0n) unheld.set(key, cents);
  }
  return { states, unheld };
}

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
    endCashCents: null,
    openPositions: 0,
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

  // The service's own start (PERS-145): a synced service opens on its cut-off with its provider's
  // opening, a flow in; what its provider covers before that day is no gap of the service.
  const cutoff = cutoffOf(book);

  // The flows (§4.6): from the end of the last gap that touches the period, and never before a
  // stream starts. A gap still open on the last day leaves nothing to measure.
  if (service.coverage !== null) {
    const coverage = service.coverage
      .filter((window) => cutoff === null || window.toOn > cutoff)
      .map((window) => (cutoff !== null && window.fromOn < cutoff ? { ...window, fromOn: cutoff } : window));
    const streams = new Set(coverage.map((window) => window.stream));
    if (streams.size === 0) {
      reasons.add("flows_gap");
      return empty(null);
    }
    for (const stream of streams) {
      const windows = coverage.filter((window) => window.stream === stream);
      const start = windows.reduce(
        (min, window) => (window.fromOn < min ? window.fromOn : min),
        windows[0].fromOn,
      );
      if (start > from && (cutoff === null || start > cutoff)) {
        from = start;
        reasons.add("flows_gap");
      }
      for (const window of windows) {
        if (window.complete || window.fromOn > e) continue;
        // A stretch of the window read every day at one value, with nothing booked in it, moved no
        // money (§4.6): covered. The cut-off's own day is its opening, a flow already booked.
        const first = [window.fromOn, from, cutoff === null ? from : addDays(cutoff, 1)].sort().at(-1)!;
        const last = addDays(window.toOn, -1) < e ? addDays(window.toOn, -1) : e;
        if (first <= last && flatSince(book, last) <= first) continue;
        if (window.toOn > e) {
          reasons.add("flows_gap");
          return empty(null);
        }
        if (window.toOn > from) {
          // A stretch read every day at one value, with nothing booked in it, moved no money (§4.6).
          const flat = flatSince(book, addDays(window.toOn, -1));
          const resumes = flat > from ? (flat < window.toOn ? flat : window.toOn) : from;
          if (resumes > from) {
            from = resumes;
            reasons.add("flows_gap");
          }
        }
      }
    }
  }

  // The value before the first day: known, zero before an account whose flows hold its whole
  // history — a manual one, a synced one from its cut-off on, or one with no opening inferred — or
  // unknown: then the period starts after the first day with a value (never a base of 0).
  const periods = sortedPeriods(book);
  let base = addDays(from, -1);
  let startCents = valueOn(book, base, rates).valueCents;
  if (startCents === null) {
    const before = periods.length === 0 || base < periods[0].fromOn;
    const inferredOpening = book.events.some(
      (event) => event.origin === "provider" && event.operations.some((op) => op.kind === "opening_position"),
    );
    const whole =
      periods[0]?.origin === "manual" || cutoff !== null || (service.coverage !== null && !inferredOpening);
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

  // The flows of [from, e], and the corrections of class `capital` as flows (§4.9).
  const classOf = (eventId: string) => service.adjustmentClasses?.get(eventId) ?? "data";
  const entries: {
    on: CivilDate;
    cents: Cents;
    transferGroupId: string | null;
    converted?: string | null;
  }[] = flowEntriesOn(book, e)
    .filter((entry) => entry.on >= from)
    .map((entry) => ({
      on: entry.on,
      cents: signed(entry),
      transferGroupId: entry.transferGroupId,
      converted: entry.converted ?? null,
    }));
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

  // The parts (§4.2) on the period's own basis (§4.4, PERS-145): a position open at s⁻ costs its
  // value at s⁻, one bought in the period what it cost; a sale is realized against that basis; the
  // unrealized is only that of the positions still open at e.
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

  const replayBase = replayHoldings(book, base, service.externalIds);
  const atStart = positionsOn(book, base, rates, replayBase);
  const basis = basisOf(book, atStart, replayBase);
  const replayEnd = replayHoldings(book, e, service.externalIds, { on: base, states: basis.states });
  const atEnd = positionsOn(book, e, rates, replayEnd);
  const exits = replayEnd.exits.filter((exit) => exit.on >= from);
  const samePeriod = periodIndexAt(book, base) === periodIndexAt(book, e) || periodIndexAt(book, base) < 0;

  const groupOfHolding = new Map(
    book.holdings.map((holding) => [
      holding.id,
      holding.origin === "provider" ? `asset:${holding.assetId}` : holding.id,
    ]),
  );
  const realizedBy = new Map<string, Cents>();
  const soldKeys = new Set<string>();
  const addTo = (map: Map<string, Cents>, key: string, cents: Cents) =>
    map.set(key, (map.get(key) ?? 0n) + cents);
  for (const exit of exits) {
    const key = groupOfHolding.get(exit.holdingId) ?? exit.holdingId;
    addTo(realizedBy, key, exit.proceedsCents - exit.costCents);
    soldKeys.add(key);
  }

  const startBy = groupPositions(atStart.positions);
  const endBy = groupPositions(atEnd.positions);
  const unrealizedBy = new Map<string, Cents>();
  const basisBy = new Map<string, Cents>(basis.unheld);
  const costUnknown = new Set<string>();
  let unrealizedChangeCents: Cents | null = 0n;
  let openPositions = 0;
  if (samePeriod && atEnd.kind === "total" && atStart.kind !== "positions") {
    // "Value only" (§4.2): no positions — what is not income, fee or correction is the change of value.
    unrealizedChangeCents = pnlCents - sumOf(realizedBy) - incomeCents - feesCents - correctionsCents;
    openPositions = endCents !== 0n ? 1 : 0;
  } else if (
    !samePeriod ||
    atEnd.kind === "unknown" ||
    atEnd.kind === "total" ||
    atStart.kind === "unknown"
  ) {
    // The positions of the last day are unknown (a conversion in the period, a day of history
    // with a total only): their change stays out of the parts.
    unrealizedChangeCents = null;
  } else {
    // What is left of the basis at e, by asset (a provider's coin across its products) or by
    // manual holding: against the value of a position still open, the unrealized; against a
    // position gone or left as dust, what its closing realized.
    for (const [holdingId, state] of replayEnd.costs) {
      addTo(basisBy, groupOfHolding.get(holdingId) ?? holdingId, state.costCents);
    }
    // A position no event and no day of s⁻ speaks of: what its provider says it cost, or unknown.
    const unknown = new Set<string>();
    for (const [key, at] of endBy) {
      if (basisBy.has(key)) continue;
      if (at.costCents !== null) basisBy.set(key, at.costCents);
      else unknown.add(key);
    }
    for (const key of new Set([...basisBy.keys(), ...endBy.keys()])) {
      const at = endBy.get(key);
      if (unknown.has(key)) {
        if (at !== undefined && isOpen(at)) openPositions += 1;
        continue;
      }
      const value = at?.valueCents ?? 0n;
      const rest = value - (basisBy.get(key) ?? 0n);
      if (at !== undefined && isOpen(at)) {
        unrealizedBy.set(key, rest);
        openPositions += 1;
      } else if (rest !== 0n) addTo(realizedBy, key, rest);
    }
    unrealizedChangeCents = unknown.size > 0 && unrealizedBy.size === 0 ? null : sumOf(unrealizedBy);
    for (const key of unknown) costUnknown.add(key);
  }
  const realizedCents = sumOf(realizedBy);
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

  // By position: what each one added in the period (realized + unrealized), the sold ones too
  // (PERS-113 · 4), on the same basis as the parts.
  const holdingIdOf = new Map<string, string>();
  for (const [holdingId, key] of groupOfHolding) if (!holdingIdOf.has(key)) holdingIdOf.set(key, holdingId);
  const assetOf = new Map(book.holdings.map((holding) => [holding.id, holding]));
  const measured = unrealizedChangeCents !== null;
  // A position open at e, with the period's basis as its cost: its unrealized is the part's.
  const endOf = (key: string): PositionAt | null => {
    const at = endBy.get(key);
    if (!at || !unrealizedBy.has(key)) return at ?? null;
    const costCents = basisBy.get(key) ?? 0n;
    return { ...at, costCents, costSource: "period", unrealizedCents: unrealizedBy.get(key)! };
  };
  const keys = new Set([...realizedBy.keys(), ...startBy.keys(), ...endBy.keys()]);
  const holdings: HoldingPnl[] = [...keys].sort().map((key) => {
    const realized = realizedBy.get(key) ?? 0n;
    const change = measured && !costUnknown.has(key) ? (unrealizedBy.get(key) ?? 0n) : null;
    const position = endBy.get(key) ?? startBy.get(key) ?? null;
    const holdingId = position?.holdingId ?? holdingIdOf.get(key) ?? null;
    const holding = holdingId === null ? undefined : assetOf.get(holdingId);
    return {
      key,
      holdingId,
      assetId: position?.assetId ?? holding?.assetId ?? null,
      product: position?.product ?? holding?.product ?? null,
      realizedCents: realized,
      unrealizedChangeCents: change,
      contributionCents: change === null ? null : realized + change,
      open: unrealizedBy.has(key) || (!measured && endBy.has(key)),
      sold: soldKeys.has(key),
      start: startBy.get(key) ?? null,
      end: endOf(key),
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

  const status: PnlStatus = reasons.has("stale_price") ? "stale" : "verified";
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
    endCashCents: atEnd.cashCents,
    openPositions,
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
  /** Some service starts later, stands on an old price or is left out: the hero says "P&L available". */
  available: boolean;
  services: ServicePnl[];
  /** In the total: not `undetermined`, with a display amount. */
  included: string[];
  excluded: { accountId: string; reasons: PnlReason[] }[];
  partial: { accountId: string; from: CivilDate }[];
  /** The services whose first or last day used an old price or rate. */
  stale: string[];
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
  const stale = included.filter((one) => one.status === "stale").map((one) => one.accountId);

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
    // Part by part, the sum of the services (PERS-145): a service's unknown unrealized stays in its
    // own unattributed, never moves another service's known one there.
    const unrealizedKnown = included.some((one) => one.display!.unrealizedChangeCents !== null);
    parts = {
      pnlCents: sum((p) => p.pnlCents) + transfersCents,
      realizedCents: sum((p) => p.realizedCents),
      unrealizedChangeCents: unrealizedKnown ? sum((p) => p.unrealizedChangeCents) : null,
      incomeCents: sum((p) => p.incomeCents),
      feesCents: sum((p) => p.feesCents),
      correctionsCents: sum((p) => p.correctionsCents),
      fxCents: sum((p) => p.fxCents),
      unattributedCents: sum((p) => p.unattributedCents),
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

  const status: PnlStatus = included.length === 0 ? "undetermined" : stale.length > 0 ? "stale" : "verified";
  return {
    currency,
    status,
    available: excluded.length > 0 || partial.length > 0 || stale.length > 0,
    services: [...services],
    included: included.map((one) => one.accountId),
    excluded,
    partial,
    stale,
    parts,
    transfersCents,
    rate,
    rateReason,
    contributions,
  };
}
