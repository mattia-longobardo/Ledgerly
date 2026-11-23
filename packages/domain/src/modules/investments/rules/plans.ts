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
import { PRICE_SCALE, QUANTITY_SCALE, RATE_SCALE, positionCents } from "./vocabulary";
import type { PlanFrequency } from "./vocabulary";

/** At most this many due dates the job adds after a stop (§11.3.2): the oldest are left to the person. */
export const MAX_CATCH_UP = 12;
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
