// src/modules/investments/rules.ts — the Investments engine (docs/design/investments.md §2): what
// an investment account is worth on a day, from its dated events, readings and reconciliations
// only. Pure: no database, no clock. Every amount is bigint — cents, or fixed-point decimals for
// quantities, prices and rates — so nothing here ever meets a float.
import { type CivilDate, addDays, lastDayOfMonth, monthKey, addMonths, isCivilDate } from "@/platform/dates";
import { convertCents, type RateTable } from "@/platform/fx/rules";
import type { Cents } from "@/platform/money";

// ——— Vocabulary ——————————————————————————————————————————————————————————————————————————————

export const INVESTMENT_CATEGORIES = ["accounts", "broker", "crypto"] as const;
export type InvestmentCategory = (typeof INVESTMENT_CATEGORIES)[number];

export const MODES = ["assets", "total"] as const;
export type Mode = (typeof MODES)[number];

export const ORIGINS = ["manual", "synced"] as const;
export type AccountOrigin = (typeof ORIGINS)[number];

export const PERIOD_REASONS = ["opening", "migration", "handover", "conversion"] as const;
export type PeriodReason = (typeof PERIOD_REASONS)[number];

export const ASSET_CLASSES = [
  "stock",
  "etf",
  "fund",
  "bond",
  "crypto",
  "stablecoin",
  "cash",
  "other",
] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

export const PRICE_SOURCES = ["manual", "provider", "market"] as const;

export const HOLDING_ORIGINS = ["manual", "provider"] as const;
export type HoldingOrigin = (typeof HOLDING_ORIGINS)[number];

/** `other:<label>` is the escape hatch for a sub-account the list does not name (A1). */
export const PRODUCTS = ["spot", "funding", "earn", "staking", "custody"] as const;
/** The products of eToro's scope (D17 · E2, E3): one per account type, and the copies. */
export const BROKER_PRODUCTS = ["trading", "cash", "crypto", "copy"] as const;
export const PRODUCT_PATTERN =
  "^(spot|funding|earn|staking|custody|trading|cash|crypto|copy|other:[a-z0-9_-]{1,30})$";

export const EVENT_ORIGINS = ["manual", "provider", "conversion"] as const;
export type EventOrigin = (typeof EVENT_ORIGINS)[number];

export const LEGS = ["main", "base", "quote", "fee"] as const;
export type Leg = (typeof LEGS)[number];

export const OPERATION_KINDS = [
  "opening_cash",
  "opening_position",
  "deposit",
  "withdrawal",
  "buy",
  "sell",
  "valuation",
  "close",
  "income",
  "fee",
  "account_valuation",
  "adjustment",
] as const;
export type OperationKind = (typeof OPERATION_KINDS)[number];

/** The kinds whose `amount_cents` has one sign (§1.5): money in is positive, money out negative. */
export const POSITIVE_KINDS = ["deposit", "sell", "close", "income"] as const;
export const NEGATIVE_KINDS = ["withdrawal", "buy", "fee"] as const;

export const QUANTITY_BASES = ["reported", "reconstructed", "inferred"] as const;

export const READING_STATUSES = ["complete", "partial", "confirmed_zero", "pending_zero"] as const;
export type ReadingStatus = (typeof READING_STATUSES)[number];

export const RECONCILIATION_KINDS = ["covered_by_provider", "outside_scope", "partial", "reopened"] as const;
export type ReconciliationKind = (typeof RECONCILIATION_KINDS)[number];

/** §1.2: what a key check can conclude; `error` is a check the provider did not answer. */
export const KEY_CHECK_RESULTS = ["read-only", "write", "unknown-flag", "unverifiable", "error"] as const;
export type KeyCheckOutcome = (typeof KEY_CHECK_RESULTS)[number];
/** Why a check ran: the connection, a replacement of the key, a pass, or "Verify". */
export const KEY_CHECK_ORIGINS = ["connect", "replace", "pass", "verify"] as const;
export type KeyCheckOrigin = (typeof KEY_CHECK_ORIGINS)[number];
export const COVERAGE_STATUSES = ["complete", "partial", "gap"] as const;

// ——— Fixed-point decimals ————————————————————————————————————————————————————————————————————

/** `numeric(38,18)`: a quantity in units of 10⁻¹⁸ (wei, satoshi and below, V8). */
export const QUANTITY_SCALE = 18;
/** `numeric(30,12)`: a unit price in units of 10⁻¹². */
export const PRICE_SCALE = 12;
/** `numeric(20,10)`: a rate in units of 10⁻¹⁰, as `fx_rates`. */
export const RATE_SCALE = 10;

const DECIMAL = /^([+-])?(\d+)(?:\.(\d+))?$/;

/**
 * A plain decimal string ("12.5", "-0.000001") as an integer of `scale` decimals, rounded half away
 * from zero past them. Anything else — a comma, an exponent, a symbol — is a `RangeError`: callers
 * normalise first.
 */
export function parseDecimal(input: string, scale: number): bigint {
  const match = DECIMAL.exec(input.trim());
  if (!match) throw new RangeError(`Not a plain decimal: "${input}"`);
  const [, sign, whole, fraction = ""] = match;
  const kept = fraction.padEnd(scale + 1, "0");
  let value = BigInt(whole) * 10n ** BigInt(scale) + BigInt(kept.slice(0, scale) || "0");
  if (Number(kept[scale]) >= 5) value += 1n;
  return sign === "-" ? -value : value;
}

/** The canonical decimal string of a fixed-point integer, without trailing zeros: "12.5", "-3". */
export function formatDecimal(value: bigint, scale: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const unit = 10n ** BigInt(scale);
  const fraction = (abs % unit).toString().padStart(scale, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${abs / unit}${fraction ? `.${fraction}` : ""}`;
}

/** `numerator / denominator` rounded half away from zero, for any signs. */
export function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError("Division by zero");
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const quotient = n / d;
  const rounded = (n % d) * 2n >= d ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/** Quantity × unit price, in cents of the price's currency. */
export function positionCents(quantity: bigint, unitPrice: bigint): Cents {
  return divRound(quantity * unitPrice, 10n ** BigInt(QUANTITY_SCALE + PRICE_SCALE - 2));
}

/** Cents of one currency at a stored rate (units of the target per unit of the source). */
export function atRate(cents: Cents, rate: bigint): Cents {
  return divRound(cents * rate, 10n ** BigInt(RATE_SCALE));
}

/** The unit price that makes `quantity` cost `cents` (for an amount typed as a total). */
export function unitPriceOf(cents: Cents, quantity: bigint): bigint {
  return divRound(cents * 10n ** BigInt(QUANTITY_SCALE + PRICE_SCALE - 2), quantity);
}

// ——— The book of one account ———————————————————————————————————————————————————————————————

export interface PeriodLike {
  fromOn: CivilDate;
  /** Where the period starts inside its first day: events ordered before it belong to the one before. */
  startsAt: Date;
  mode: Mode;
  origin: AccountOrigin;
}

export interface OperationLike {
  leg: Leg;
  holdingId: string | null;
  kind: OperationKind;
  quantity: bigint | null;
  unitPrice: bigint | null;
  priceCurrency: string | null;
  /** Signed, in the account's currency (§1.5). */
  amountCents: Cents;
  /** Account units per unit of `priceCurrency`, saved when the operation was written (A5). */
  fxRate: bigint | null;
  validUntil: CivilDate | null;
}

export interface EventLike {
  id: string;
  on: CivilDate;
  occurredAt: Date;
  seq: bigint;
  origin: EventOrigin;
  transferGroupId: string | null;
  operations: readonly OperationLike[];
}

export interface HoldingLike {
  id: string;
  assetId: string;
  origin: HoldingOrigin;
  product: string;
  /** The asset's quote currency. */
  currency: string;
}

export interface ReadingLike {
  id: string;
  on: CivilDate;
  status: ReadingStatus;
  totalCents: Cents;
  positions: readonly { assetId: string; product: string; valueCents: Cents | null }[];
  scopes: readonly { product: string; complete: boolean }[];
}

export interface ReconciliationLike {
  holdingId: string;
  effectiveOn: CivilDate;
  kind: ReconciliationKind;
  quantity: bigint | null;
  decidedAt: Date;
}

export interface Book {
  /** `accounts.currency`: every amount of the account is in it. */
  currency: string;
  periods: readonly PeriodLike[];
  events: readonly EventLike[];
  holdings: readonly HoldingLike[];
  readings: readonly ReadingLike[];
  reconciliations: readonly ReconciliationLike[];
}

/** The deterministic order of events (A2): day, then the moment, then the insertion sequence. */
export function compareEvents(a: EventLike, b: EventLike): number {
  if (a.on !== b.on) return a.on < b.on ? -1 : 1;
  const time = a.occurredAt.getTime() - b.occurredAt.getTime();
  if (time !== 0) return time;
  return a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0;
}

function comparePeriods(a: PeriodLike, b: PeriodLike): number {
  if (a.fromOn !== b.fromOn) return a.fromOn < b.fromOn ? -1 : 1;
  return a.startsAt.getTime() - b.startsAt.getTime();
}

function sortedPeriods(book: Book): PeriodLike[] {
  return [...book.periods].sort(comparePeriods);
}

/** The period an event belongs to: the last one that starts at or before it. */
function periodIndexOf(periods: readonly PeriodLike[], event: { on: CivilDate; occurredAt: Date }): number {
  let found = -1;
  for (let index = 0; index < periods.length; index++) {
    const period = periods[index];
    const starts =
      period.fromOn < event.on ||
      (period.fromOn === event.on && period.startsAt.getTime() <= event.occurredAt.getTime());
    if (starts) found = index;
  }
  return found;
}

/** The period in force at the end of `on`: the last one that starts on or before it. */
function periodIndexOn(periods: readonly PeriodLike[], on: CivilDate): number {
  let found = -1;
  for (let index = 0; index < periods.length; index++) if (periods[index].fromOn <= on) found = index;
  return found;
}

/** The events of the period in force at the end of `on`, up to `on`, in order. */
function eventsOn(book: Book, on: CivilDate): { period: PeriodLike | null; events: EventLike[] } {
  const periods = sortedPeriods(book);
  const index = periodIndexOn(periods, on);
  if (index < 0) return { period: null, events: [] };
  const events = book.events
    .filter((event) => event.on <= on && periodIndexOf(periods, event) === index)
    .sort(compareEvents);
  return { period: periods[index], events };
}

// ——— Positions —————————————————————————————————————————————————————————————————————————————

export interface HoldingState {
  holdingId: string;
  /** `null` for a position kept by value only (a BTP, a fund bought for an amount, A3). */
  quantity: bigint | null;
  /** The last unit price (buy, sell, valuation, opening), in `priceCurrency`. */
  unitPrice: bigint | null;
  priceCurrency: string | null;
  pricedOn: CivilDate | null;
  /** The value in the account's currency; `null` only when neither a rate nor a saved one exists. */
  valueCents: Cents | null;
  /** What is still invested in it at average cost, in the account's currency. */
  costCents: Cents;
  /** The part of value − cost due to the exchange rate (assets quoted in another currency). */
  fxEffectCents: Cents;
  /** The value used a saved rate because `fx_rates` had none for the day. */
  staleRate: boolean;
  open: boolean;
}

const abs = (value: bigint) => (value < 0n ? -value : value);

/**
 * Every holding's state at the end of `on` (§2.1, A2): quantity, last price, value and cost, from
 * the events of the period in force only. The value of an asset quoted in another currency uses the
 * ECB rate of `on`; without one, the rate saved on the operation that set the price, flagged.
 */
export function holdingStates(book: Book, on: CivilDate, rates: RateTable): Map<string, HoldingState> {
  const { events } = eventsOn(book, on);
  const byId = new Map(book.holdings.map((holding) => [holding.id, holding]));
  interface Running {
    quantity: bigint | null;
    unitPrice: bigint | null;
    priceCurrency: string | null;
    pricedOn: CivilDate | null;
    priceRate: bigint | null;
    /** By-value positions: the value set by the last valuation, moved by later buys and sells. */
    valueCents: Cents;
    costCents: Cents;
    /** Σ quantity × saved rate, for the average rate the cost was paid at. */
    rateWeight: bigint;
    rateQuantity: bigint;
    touched: boolean;
    closed: boolean;
  }
  const running = new Map<string, Running>();
  const stateOf = (id: string): Running => {
    let state = running.get(id);
    if (!state) {
      state = {
        quantity: null,
        unitPrice: null,
        priceCurrency: null,
        pricedOn: null,
        priceRate: null,
        valueCents: 0n,
        costCents: 0n,
        rateWeight: 0n,
        rateQuantity: 0n,
        touched: false,
        closed: false,
      };
      running.set(id, state);
    }
    return state;
  };
  for (const event of events) {
    for (const op of event.operations) {
      if (op.holdingId === null || !byId.has(op.holdingId)) continue;
      const state = stateOf(op.holdingId);
      const price = () => {
        if (op.unitPrice !== null) {
          state.unitPrice = op.unitPrice;
          state.priceCurrency = op.priceCurrency;
          state.pricedOn = event.on;
          state.priceRate = op.fxRate;
        }
      };
      switch (op.kind) {
        case "opening_position":
        case "buy": {
          state.touched = true;
          state.closed = false;
          const cost = abs(op.amountCents);
          if (op.quantity === null) {
            state.valueCents += cost;
          } else {
            state.quantity = (state.quantity ?? 0n) + op.quantity;
            if (op.fxRate !== null) {
              state.rateWeight += op.quantity * op.fxRate;
              state.rateQuantity += op.quantity;
            }
          }
          state.costCents += cost;
          price();
          break;
        }
        case "sell": {
          if (op.quantity === null) {
            const before = state.valueCents;
            state.valueCents -= abs(op.amountCents);
            if (before > 0n) state.costCents = divRound(state.costCents * state.valueCents, before);
          } else {
            const before = state.quantity ?? 0n;
            const after = before - op.quantity;
            if (before > 0n) state.costCents = divRound(state.costCents * (after > 0n ? after : 0n), before);
            if (state.rateQuantity > 0n && before > 0n) {
              state.rateWeight = divRound(state.rateWeight * (after > 0n ? after : 0n), before);
              state.rateQuantity = after > 0n ? after : 0n;
            }
            state.quantity = after;
          }
          price();
          break;
        }
        case "valuation":
          state.touched = true;
          if (op.quantity === null && op.unitPrice === null) state.valueCents = op.amountCents;
          price();
          break;
        case "close":
          state.quantity = state.quantity === null ? null : 0n;
          state.valueCents = 0n;
          state.costCents = 0n;
          state.rateWeight = 0n;
          state.rateQuantity = 0n;
          state.closed = true;
          price();
          break;
        case "income":
          if (op.quantity !== null) state.quantity = (state.quantity ?? 0n) + op.quantity;
          break;
        case "fee":
          if (op.quantity !== null) state.quantity = (state.quantity ?? 0n) - op.quantity;
          break;
        default:
          break;
      }
    }
  }
  const states = new Map<string, HoldingState>();
  for (const [holdingId, state] of running) {
    if (!state.touched) continue;
    let valueCents: Cents | null;
    let staleRate = false;
    let fxEffectCents = 0n;
    if (state.quantity === null) {
      valueCents = state.closed ? 0n : state.valueCents;
    } else if (state.unitPrice === null || state.quantity <= 0n) {
      valueCents = 0n;
    } else {
      const currency = state.priceCurrency ?? book.currency;
      const native = positionCents(state.quantity, state.unitPrice);
      valueCents = convertCents(native, currency, book.currency, on, rates);
      if (valueCents === null && state.priceRate !== null) {
        valueCents = atRate(native, state.priceRate);
        staleRate = true;
      }
      if (valueCents !== null && currency !== book.currency && state.rateQuantity > 0n) {
        const paidRate = divRound(state.rateWeight, state.rateQuantity);
        fxEffectCents = valueCents - atRate(native, paidRate);
      }
    }
    const open = !state.closed && (state.quantity === null ? state.valueCents > 0n : state.quantity > 0n);
    states.set(holdingId, {
      holdingId,
      quantity: state.quantity,
      unitPrice: state.unitPrice,
      priceCurrency: state.priceCurrency,
      pricedOn: state.pricedOn,
      valueCents: open ? valueCents : 0n,
      costCents: open ? state.costCents : 0n,
      fxEffectCents: open ? fxEffectCents : 0n,
      staleRate,
      open,
    });
  }
  return states;
}

// ——— The value of a day ————————————————————————————————————————————————————————————————————

export interface Conflict {
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
function cashEffect(op: OperationLike): Cents {
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
const COUNTING: ReadonlySet<ReadingStatus> = new Set(["complete", "partial", "confirmed_zero"]);

/**
 * V(A,d) (§2): the value of the account at the end of `on`, in its currency.
 *
 * - manual, `assets`: cash + Σ positions (§2.1);
 * - manual, `total`: the last account valuation + the net flows after it, never below zero;
 *   unknown (`null`) while money went in before any valuation (§2.1, the legacy rule);
 * - synced: P − C + M + R (§2.2, R1–R6).
 *
 * Adjustments (R3) apply in every mode. Only the events of the period in force count (A3).
 */
export function valueOn(book: Book, on: CivilDate, rates: RateTable): DayValue {
  const { period, events } = eventsOn(book, on);
  if (period === null) return EMPTY;
  const adjustmentCents = adjustmentsOn(events, on);

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
  const reading =
    book.readings
      .filter((one) => one.on >= period.fromOn && one.on <= on && COUNTING.has(one.status))
      .sort((a, b) => (a.on < b.on ? 1 : a.on > b.on ? -1 : 0))[0] ?? null;
  if (reading === null) return { ...EMPTY, mode: period.mode, origin: "synced", adjustmentCents };
  missing += reading.positions.filter((position) => position.valueCents === null).length;

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

export interface Point {
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
    const value = valueOn(book, on, rates).valueCents;
    if (value !== null) points.push({ on, cents: value });
  }
  return points;
}

/** The oldest day a change touches: rewriting starts there (§1.7). */
export function oldestDay(...days: readonly (CivilDate | null | undefined)[]): CivilDate | null {
  const known = days.filter((day): day is CivilDate => typeof day === "string" && isCivilDate(day));
  return known.length === 0 ? null : known.reduce((a, b) => (a < b ? a : b));
}

// ——— Money in and out (§2.4) ——————————————————————————————————————————————————————————————

export interface Flows {
  /** What the first period opened with: opening cash, positions, or the handover valuation. */
  openingCents: Cents;
  depositedCents: Cents;
  withdrawnCents: Cents;
}

/**
 * The money that went into the account up to `on`: the opening of its first period, plus deposits,
 * minus withdrawals. A later conversion opens a new period at the same value (V before = V after),
 * so it is no flow.
 */
export function flowsOn(book: Book, on: CivilDate): Flows {
  const periods = sortedPeriods(book);
  let openingCents = 0n;
  let depositedCents = 0n;
  let withdrawnCents = 0n;
  for (const event of book.events) {
    if (event.on > on) continue;
    const firstPeriod = periodIndexOf(periods, event) === 0;
    for (const op of event.operations) {
      if (op.kind === "deposit") depositedCents += op.amountCents;
      else if (op.kind === "withdrawal") withdrawnCents -= op.amountCents;
      else if (event.origin === "conversion" && firstPeriod) {
        if (op.kind === "opening_cash" || op.kind === "account_valuation") openingCents += op.amountCents;
        else if (op.kind === "opening_position") openingCents += abs(op.amountCents);
      }
    }
  }
  return { openingCents, depositedCents, withdrawnCents };
}

export interface Performance {
  investedCents: Cents;
  /** V − opening − deposits + withdrawals. */
  gainCents: Cents | null;
  /** gain ÷ (opening + deposits); `null` without a value or without money in. */
  simpleReturn: number | null;
}

export function performance(flows: Flows, valueCents: Cents | null): Performance {
  const investedCents = flows.openingCents + flows.depositedCents - flows.withdrawnCents;
  const gainCents = valueCents === null ? null : valueCents - investedCents;
  const base = flows.openingCents + flows.depositedCents;
  return {
    investedCents,
    gainCents,
    simpleReturn: gainCents === null || base <= 0n ? null : Number(gainCents) / Number(base),
  };
}

// ——— Empty readings (R5) ————————————————————————————————————————————————————————————————————

/** Below this a vanished balance is believable without asking (R5): 50 €, in cents. */
export const ZERO_THRESHOLD_CENTS = 5_000n;

/**
 * A valid, complete, empty answer (R5): it counts (`confirmed_zero`) when the reading before was
 * worth less than the threshold or a withdrawal of the last 7 days explains it; otherwise it waits
 * for the person (`pending_zero`) and the value holds.
 */
export function emptyReadingStatus(input: {
  previousCents: Cents | null;
  withdrawalWithin7Days: boolean;
  thresholdCents?: Cents;
}): "confirmed_zero" | "pending_zero" {
  const threshold = input.thresholdCents ?? ZERO_THRESHOLD_CENTS;
  if (input.previousCents === null || input.previousCents < threshold || input.withdrawalWithin7Days) {
    return "confirmed_zero";
  }
  return "pending_zero";
}

// ——— Conversions (§2.5) ——————————————————————————————————————————————————————————————————————

export interface DeclaredPosition {
  holdingId: string;
  quantity: bigint | null;
  unitPrice: bigint | null;
  /** The position's value in the account's currency. */
  valueCents: Cents;
}

/**
 * `total` → `assets` at T: the opening cash that keeps V(T) unchanged — V(T) minus the positions
 * declared. Negative when the positions are worth more than the account: the dialog asks.
 */
export function openingCashFor(valueCents: Cents, positions: readonly DeclaredPosition[]): Cents {
  return positions.reduce<Cents>((cash, position) => cash - position.valueCents, valueCents);
}

/** The months a chart covers, oldest first, ending with the month of `today`. */
export function monthsBack(today: CivilDate, count: number): string[] {
  const last = monthKey(today);
  return Array.from({ length: count }, (_, index) => addMonths(last, index - count + 1));
}

/**
 * A number typed in the person's format ("1.234,5" in it-IT) as the plain decimal `parseDecimal`
 * reads: spaces and group separators dropped, the decimal separator turned into a point.
 */
export function plainDecimal(input: string, separators: { decimal: string; group: string }): string {
  const cleaned = input.replace(/[\s  ]/g, "").replace(/−/g, "-");
  if (cleaned === "") throw new RangeError("Empty number");
  return cleaned.split(separators.group).join("").replace(separators.decimal, ".");
}
