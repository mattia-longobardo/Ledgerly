// The purchase plans (rewrite plan R5d, step 2; 11-standardization.md §11.3): their due dates, the
// quantity an amount buys at a price and the fee of an instalment. Pure, as the rest of the engine.
import {
  addDays,
  addMonths,
  type CivilDate,
  dayOfWeek,
  lastDayOfMonth,
  monthKey,
} from "../../../shared/dates";
import type { Cents } from "../../../shared/money";
import { atRate, PRICE_SCALE, QUANTITY_SCALE, RATE_SCALE, positionCents, WEIGHT_WHOLE } from "./vocabulary";
import type { PlanFrequency, PlanLineState } from "./vocabulary";

/** At most this many due dates the job adds after a stop (§11.3.2): the oldest are left to the person. */
export const MAX_CATCH_UP = 12;
/** The past due dates «Record the past instalments» takes at once (P4). */
export const MAX_BACKFILL_RUNS = 60;
/** The decimals a plan for an amount buys when it buys fractions (P3). */
export const FRACTION_DECIMALS = 6;

export interface PlanSchedule {
  frequency: PlanFrequency;
  interval: number;
  /** Of the month (1-31, the month's last when shorter), or of the week (1 Monday - 7 Sunday). */
  day: number;
  startOn: CivilDate;
  endOn: CivilDate | null;
  runsLimit: number | null;
}

/** The k-th date of the schedule from its anchor (k = 0, 1, …), before the start's filter. */
function nthDate(plan: PlanSchedule, index: number): CivilDate {
  if (plan.frequency === "day") {
    // Monday to Friday only (PERS-681): the first working day on or after the start, then every
    // `interval` working days. Weekdays are counted from Monday (0) to Friday (4).
    const startDay = dayOfWeek(plan.startOn);
    const first = addDays(plan.startOn, startDay === 6 ? 2 : startDay === 0 ? 1 : 0);
    const offset = dayOfWeek(first) - 1;
    const position = offset + index * plan.interval;
    return addDays(first, 7 * Math.floor(position / 5) + (position % 5) - offset);
  }
  if (plan.frequency === "week") {
    // The first `day` of the week on or after the start, then every `interval` weeks.
    const shift = (plan.day % 7) - dayOfWeek(plan.startOn);
    const first = addDays(plan.startOn, (shift + 7) % 7);
    return addDays(first, index * 7 * plan.interval);
  }
  const months = (plan.frequency === "quarter" ? 3 : 1) * plan.interval;
  const month = addMonths(monthKey(plan.startOn), index * months);
  const last = lastDayOfMonth(month);
  const day = Math.min(plan.day, Number(last.slice(8, 10)));
  return `${month.slice(0, 8)}${String(day).padStart(2, "0")}`;
}

/**
 * The due dates of a plan up to `to`, both included, in order: from its start, up to its end day or its
 * number of instalments. A monthly date of the 31st falls on the month's last day.
 */
export function dueDates(plan: PlanSchedule, to: CivilDate): CivilDate[] {
  const dates: CivilDate[] = [];
  const end = plan.endOn !== null && plan.endOn < to ? plan.endOn : to;
  for (let index = 0; ; index += 1) {
    const date = nthDate(plan, index);
    if (date < plan.startOn) continue;
    if (date > end || (plan.runsLimit !== null && dates.length >= plan.runsLimit)) return dates;
    dates.push(date);
  }
}

/** Whether the plan has a due date after `day`: false once its end or its last instalment is past. */
export function endedBy(plan: PlanSchedule, day: CivilDate): boolean {
  if (plan.endOn !== null && plan.endOn <= day) return true;
  return plan.runsLimit !== null && dueDates(plan, day).length >= plan.runsLimit;
}

/**
 * The quantity an amount buys at a unit price, both in the asset's currency: fractions to 6 decimals,
 * or whole units only (P3). Rounded down: an instalment never spends more than its amount.
 */
export function quantityFor(amountCents: Cents, unitPrice: bigint, fractions: boolean): bigint {
  if (unitPrice <= 0n) return 0n;
  const exact = (amountCents * 10n ** BigInt(QUANTITY_SCALE + PRICE_SCALE)) / (100n * unitPrice);
  const step = 10n ** BigInt(fractions ? QUANTITY_SCALE - FRACTION_DECIMALS : QUANTITY_SCALE);
  return (exact / step) * step;
}

/** The fee of an instalment (E3): its fixed amount, or its rate of what the instalment spends. */
export function planFee(fee: { cents: Cents | null; rate: bigint | null }, spentCents: Cents): Cents {
  if (fee.cents !== null) return fee.cents;
  if (fee.rate === null) return 0n;
  const scale = 10n ** BigInt(RATE_SCALE);
  return (spentCents * fee.rate + scale / 2n) / scale;
}

/** What an instalment buys at a price: its quantity, what it spends and its fee. */
export function instalment(
  plan: {
    amountCents: Cents | null;
    quantity: bigint | null;
    fractions: boolean;
    fee: { cents: Cents | null; rate: bigint | null };
  },
  unitPrice: bigint,
): { quantity: bigint; spentCents: Cents; feeCents: Cents } {
  const quantity = plan.quantity ?? quantityFor(plan.amountCents ?? 0n, unitPrice, plan.fractions);
  const spentCents = positionCents(quantity, unitPrice);
  return { quantity, spentCents, feeCents: planFee(plan.fee, spentCents) };
}

/** A line of a basket's execution as the allocation reads it (PERS-681 §2.1). */
export interface AllocationInput {
  assetId: string;
  /** Basis points of the budget (1-10000, all of them 10000). */
  weightBp: number;
  /** The close, in the asset's currency at `PRICE_SCALE`; null with no price (or no rate) yet. */
  unitPrice: bigint | null;
  /** Units of the plan's currency one unit of the asset's is worth, at `RATE_SCALE`; null: the same currency. */
  rate: bigint | null;
}

export interface AllocationLine extends AllocationInput {
  targetCents: Cents;
  /** Whole shares, at `QUANTITY_SCALE`. */
  quantity: bigint;
  /** What the shares cost, in cents of the plan's currency. */
  spentCents: Cents;
  state: PlanLineState;
}

export interface Allocation {
  lines: AllocationLine[];
  spentCents: Cents;
  carryOutCents: Cents;
}

/** What `quantity` of an asset costs at `unitPrice`, in cents of the plan's currency (rounded once). */
export function spentAt(quantity: bigint, unitPrice: bigint, rate: bigint | null): Cents {
  const native = positionCents(quantity, unitPrice);
  return rate === null ? native : atRate(native, rate);
}

/**
 * The whole shares a budget buys of each instrument of a basket (PERS-681 §2.2): its part of the
 * budget rounded down, then the shares that part pays rounded down. A share that costs more than
 * the part skips the line (M2). What is not spent is the carry of the next execution (M1); no
 * second round in this one. Fees are outside the budget (D1). Never spends more than the budget.
 */
export function allocateWholeShares(budgetCents: Cents, lines: readonly AllocationInput[]): Allocation {
  const budget = budgetCents > 0n ? budgetCents : 0n;
  const one = 10n ** BigInt(QUANTITY_SCALE);
  const allocated = lines.map((line): AllocationLine => {
    const targetCents = (budget * BigInt(line.weightBp)) / BigInt(WEIGHT_WHOLE);
    if (line.unitPrice === null || line.unitPrice <= 0n) {
      return { ...line, targetCents, quantity: 0n, spentCents: 0n, state: "price_missing" };
    }
    // One share in cents of the plan's currency is unitPrice × rate × 100 / 10^(PRICE + RATE).
    const rate = line.rate ?? 10n ** BigInt(RATE_SCALE);
    const shares = (targetCents * 10n ** BigInt(PRICE_SCALE + RATE_SCALE)) / (line.unitPrice * rate * 100n);
    const quantity = shares * one;
    if (shares === 0n) return { ...line, targetCents, quantity, spentCents: 0n, state: "too_expensive" };
    return {
      ...line,
      targetCents,
      quantity,
      spentCents: spentAt(quantity, line.unitPrice, line.rate),
      state: "buy",
    };
  });
  const spentCents = allocated.reduce((sum, line) => sum + line.spentCents, 0n);
  return { lines: allocated, spentCents, carryOutCents: budget - spentCents };
}
