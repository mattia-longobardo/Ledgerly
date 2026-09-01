/**
 * Planned vs actual leave, per month — the owner's requirement 4:
 * "se un mese era previsto x giorni ma alla fine ne sono stati fatti di più o
 * di meno segnalalo."
 *
 * Two sources, deliberately never merged into one number:
 *
 *   PLANNED — the calendar (Trek, mirrored in `leave_days`), summed per month as
 *             days, a half day counting 0.5. This is the only source that knows
 *             *which* days.
 *   ACTUAL  — the payslips, via `leaveTakenByMonth()`, in hours ÷ hoursPerDay.
 *             This is the only source that knows what payroll actually booked.
 *
 * ⚠ `leaveTakenByMonth()` already shifts each payslip back one month (the
 * owner's rule: "le ferie sul cedolino sono quelle usate il mese prima"), so the
 * months it returns are USAGE months and line up directly with calendar months.
 * Nothing here re-shifts them. See the long comment in `calc/payroll.ts` for the
 * known July inconsistency that rule carries.
 */

import type { LeaveTakenMonth } from "./payroll";

/**
 * How far the two may drift before it is worth telling the owner: a quarter of
 * a day.
 *
 * Bounded from ABOVE by the calendar's resolution — half a day is the smallest
 * thing Trek can express, so any tolerance ≥ 0.5 would swallow a real, fully
 * representable difference. Bounded from BELOW by the payslip, which reports
 * hours to two decimals and does not divide cleanly into days: the August
 * payslip reads 12,01 h against 12,00 h of actual usage, and at 8 h/day that
 * alone is a 0,00125-day difference. Sitting at exactly half the calendar's
 * resolution keeps the flag deaf to hour-level payroll noise while guaranteeing
 * every difference the calendar can actually represent gets flagged.
 *
 * Expressed in days rather than hours so it scales with `hoursPerDay`, which is
 * a setting, not a constant.
 */
export const VARIANCE_TOLERANCE_DAYS = 0.25;

export type LeaveVarianceStatus =
  /** Planned and actual agree within tolerance. */
  | "match"
  /** More was taken than planned. */
  | "over"
  /** Less was taken than planned. */
  | "under"
  /** At or after the latest verified payslip: no actual can exist yet, planned only. */
  | "planned"
  /** A month BEFORE P whose covering payslip is missing mid-series — a real gap. */
  | "awaiting_payslip"
  /** A payslip reports leave for a month the calendar never covered. */
  | "no_calendar";

export interface LeaveMonthVariance {
  /** Month key pinned to the 1st. */
  month: string;
  plannedDays: number;
  /** `null` when no payslip covers this month yet. */
  actualDays: number | null;
  /** actual − planned; positive means more was taken. `null` without an actual. */
  deltaDays: number | null;
  status: LeaveVarianceStatus;
  /** The single field the UI keys its warning off. */
  flagged: boolean;
}

export interface LeaveVarianceInput {
  /** From `plannedDaysByMonth()` — calendar days per month. */
  planned: readonly { month: string; days: number }[];
  /** From `leaveTakenByMonth()` — already month-shifted and in days. */
  actual: readonly LeaveTakenMonth[];
  /**
   * The boundary between "planned" and "comparable": the month of the LATEST
   * verified payslip, P. Every month AT OR AFTER it is `planned`.
   *
   * Why the payslip and not "now": an Italian payslip reports the leave TAKEN in
   * the month BEFORE the payslip's own — `leaveTakenByMonth()` already shifts
   * each actual back by one (the owner's rule "le ferie sul cedolino sono quelle
   * usate il mese prima"). So the payslip for month P is the one that will
   * finally record month P−1's usage, and NO payslip yet exists that covers any
   * month ≥ P. Concretely: the September payslip is what records August's
   * vacation, so until September's payslip is verified, August has no actual and
   * must read `planned` ("previsto"), never compared or flagged — the owner's
   * "Agosto è ancora planned perché è il payslip di settembre che segnerà le
   * vacanze di agosto". Only months < P (whose covering payslip, for M+1 ≤ P,
   * is in hand) are comparable.
   *
   * P ≤ the current month always (a payslip is of the past or present), so this
   * boundary is stricter than "now" and fully subsumes it: a future month is
   * ≥ P and therefore still planned — which is why there is no separate
   * `currentMonth` input. Omit when there is no verified payslip at all: then
   * every month is planned, because nothing can be compared yet.
   */
  firstPlannedMonth?: string;
  /**
   * Earliest month the calendar is known to cover, across ITS WHOLE HISTORY —
   * the month of the oldest day ever mirrored, not the first booking of the year
   * being displayed. Months before it report `no_calendar` instead of a bogus
   * "took 2 days you never planned": the calendar simply did not exist yet,
   * which is not a discrepancy worth an alert. Anything after it is covered,
   * including a month with nothing booked in it — that month planned zero days,
   * and a payslip claiming otherwise is precisely what wants flagging. Omit to
   * treat the whole history as covered.
   */
  earliestCalendarMonth?: string;
  tolerance?: number;
}

/**
 * One row per month that either side knows about, ascending.
 *
 * A month is only ever flagged when there is something real to compare: the
 * payslip that COVERS it (the one for the next month, ≤ P) has been verified,
 * the calendar covered it, and the two differ by more than the tolerance. Every
 * month at or after the latest verified payslip P is planned-only — its own
 * covering payslip has not arrived yet — and is never flagged; the owner asked
 * for "previsto", not a warning about leave payroll has not booked yet.
 */
export function leaveVariance(input: LeaveVarianceInput): LeaveMonthVariance[] {
  const tolerance = input.tolerance ?? VARIANCE_TOLERANCE_DAYS;

  const plannedByMonth = new Map<string, number>();
  for (const p of input.planned) plannedByMonth.set(p.month, p.days);

  const actualByMonth = new Map<string, number>();
  for (const a of input.actual) actualByMonth.set(a.month, a.totalDays);

  const months = [...new Set([...plannedByMonth.keys(), ...actualByMonth.keys()])].sort();

  return months.map((month): LeaveMonthVariance => {
    const plannedDays = plannedByMonth.get(month) ?? 0;
    const rawActual = actualByMonth.get(month);
    const actualDays = rawActual ?? null;

    // At or after the latest verified payslip P: the payslip that would record
    // this month's usage is the NEXT month's (≥ P+1), which does not exist yet —
    // so there is no actual to compare, only the plan. No verified payslip at
    // all (firstPlannedMonth undefined) → every month is planned.
    if (input.firstPlannedMonth === undefined || month >= input.firstPlannedMonth) {
      return { month, plannedDays, actualDays, deltaDays: null, status: "planned", flagged: false };
    }

    if (actualDays === null) {
      return {
        month,
        plannedDays,
        actualDays: null,
        deltaDays: null,
        status: "awaiting_payslip",
        flagged: false,
      };
    }

    if (input.earliestCalendarMonth !== undefined && month < input.earliestCalendarMonth) {
      return {
        month,
        plannedDays,
        actualDays,
        deltaDays: null,
        status: "no_calendar",
        flagged: false,
      };
    }

    const deltaDays = Number((actualDays - plannedDays).toFixed(2));
    if (Math.abs(deltaDays) <= tolerance) {
      return { month, plannedDays, actualDays, deltaDays, status: "match", flagged: false };
    }

    return {
      month,
      plannedDays,
      actualDays,
      deltaDays,
      status: deltaDays > 0 ? "over" : "under",
      flagged: true,
    };
  });
}

export function flaggedMonths(rows: readonly LeaveMonthVariance[]): LeaveMonthVariance[] {
  return rows.filter((r) => r.flagged);
}
