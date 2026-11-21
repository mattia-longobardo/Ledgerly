import { type CivilDate, type MonthKey, addDays, dayOfWeek } from "../../../shared/dates";
import { isWeekend } from "../../../platform/holidays/rules";
import {
  LEAVE_DAY_KINDS,
  dayStatus,
  minuteWeight,
  type DayStatus,
  type LeaveDayKind,
  type LeaveDayView,
} from "./days";

/* The residual, and where it comes from (spec §7.9, the binding rule) */

/** Which of the two formulas produced a residual — the interface always says which. */
export const RESIDUAL_BASES = ["payslip", "allowance", "unknown"] as const;
export type ResidualBasis = (typeof RESIDUAL_BASES)[number];

interface ResidualSnapshot {
  /** The month of the payslip that printed it. */
  period: MonthKey;
  /** What the payslip printed as RES., in hours. */
  remainingHours: number;
}

export interface ResidualInput {
  /** The last applied payslip's snapshot for this kind, when there is one. */
  snapshot: ResidualSnapshot | null;
  /**
   * The year's allowance, in minutes, and what the years before it left over, likewise.
   *
   * The carry-over is the payslip's own A.P. since N9, not something anybody types: it is counted
   * for every kind (N1), and it is added only on the `allowance` basis — a printed RES. already
   * has it inside (A.P. + MAT. − GOD. = RES.).
   */
  allowanceMinutes: number | null;
  carriedMinutes: number;
  /** Every local day of this kind in the year. */
  days: readonly LeaveDayView[];
  /** The last month of use an applied payslip accounts for; `null` when there is none. */
  countedThrough: MonthKey | null;
  minutesPerDay: number;
}

/**
 * A residual, always in **minutes** (plan F7 §3.4.4).
 *
 * Minutes and not days, because days are the coarser of the two units: a ROL balance of 3½ hours
 * rounded to the nearest half day and converted back comes out as 4, and the card would print a
 * number the payslip never said. The caller divides by the day length for the kinds counted in
 * days — which is exact, since those are stored as whole or half days in the first place.
 */
export interface ResidualView {
  basis: ResidualBasis;
  /** `null` when neither formula applies: the interface shows "—" and the reason. */
  remainingMinutes: number | null;
  takenMinutes: number;
  plannedMinutes: number;
  /**
   * For `payslip`: the month whose payslip printed the residual, and the last month of use it
   * accounts for (its own month minus one). `null` otherwise.
   */
  snapshotPeriod: MonthKey | null;
  countedThrough: MonthKey | null;
}

/**
 * The residual of one kind, in minutes, and the provenance of the number (spec §7.9).
 *
 * Two formulas, never mixed:
 *  - with a payslip snapshot, the payslip's RES. is the truth up to the month it accounts for, and
 *    only the **planned** days are subtracted — which since N2 means exactly the days that month
 *    does not cover. Subtracting days the payslip already counted would count them twice, and so
 *    would adding the carry-over, which is already inside the printed RES.;
 *  - without one, the plain `allowance + carried − taken − planned`, carry-over included (N1).
 *
 * With neither a snapshot nor an allowance the answer is `null`, not zero: "we do not know" and
 * "nothing left" are different things, and the card says which one it is showing.
 */
export function residual(input: ResidualInput): ResidualView {
  const { snapshot, allowanceMinutes, carriedMinutes, days, countedThrough, minutesPerDay } = input;

  const weigh = (subset: readonly LeaveDayView[]): number =>
    subset.reduce((sum, day) => sum + minuteWeight(day, minutesPerDay), 0);
  const taken = days.filter((day) => dayStatus(day.on, countedThrough) === "taken");
  const planned = days.filter((day) => dayStatus(day.on, countedThrough) === "planned");
  const takenMinutes = weigh(taken);
  const plannedMinutes = weigh(planned);

  if (snapshot) {
    // The payslip's RES. already has the previous years inside it (A.P. + MAT. − GOD. = RES.), so
    // the carry-over is **not** added here — it would be counted twice.
    return {
      basis: "payslip",
      remainingMinutes: Math.round(snapshot.remainingHours * 60) - plannedMinutes,
      takenMinutes,
      plannedMinutes,
      snapshotPeriod: snapshot.period,
      countedThrough,
    };
  }

  if (allowanceMinutes === null) {
    return {
      basis: "unknown",
      remainingMinutes: null,
      takenMinutes,
      plannedMinutes,
      snapshotPeriod: null,
      countedThrough,
    };
  }

  return {
    basis: "allowance",
    remainingMinutes: allowanceMinutes + carriedMinutes - takenMinutes - plannedMinutes,
    takenMinutes,
    plannedMinutes,
    snapshotPeriod: null,
    countedThrough,
  };
}

/* The "By month" bars of the design */

export interface MonthBar {
  /** 1–12. */
  month: number;
  /** Minutes, like every other total here; the chart divides for its labels. */
  takenMinutes: number;
  plannedMinutes: number;
}

/**
 * Twelve bars, one per month, always all twelve: a month with nothing in it is a gap in the chart,
 * not a missing bar. Taken and planned are kept apart because the design stacks them.
 */
export function monthBars(
  days: readonly LeaveDayView[],
  year: number,
  minutesPerDay: number,
  countedThrough: MonthKey | null,
): MonthBar[] {
  const bars: MonthBar[] = Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    takenMinutes: 0,
    plannedMinutes: 0,
  }));
  for (const day of days) {
    if (Number(day.on.slice(0, 4)) !== year) continue;
    const bar = bars[Number(day.on.slice(5, 7)) - 1];
    const weight = minuteWeight(day, minutesPerDay);
    if (dayStatus(day.on, countedThrough) === "taken") bar.takenMinutes += weight;
    else bar.plannedMinutes += weight;
  }
  return bars;
}

/* The twelve calendar grids of the design */

export interface CalendarCell {
  date: CivilDate | null;
  /** Empty for a day with nothing on it, and for the blanks that pad a month to whole weeks. */
  kinds: LeaveDayKind[];
  status: DayStatus | null;
  weekend: boolean;
  holiday: boolean;
  /** Less than a whole day off: the cell is drawn half-filled rather than merely paler. */
  partial: boolean;
}

export interface CalendarMonth {
  month: number;
  /** Whole weeks, padded with `date: null` at both ends. */
  weeks: CalendarCell[][];
}

/**
 * The year as twelve grids of whole weeks. `weekStart` is the user's (0 Sunday … 6 Saturday), so
 * an Italian calendar starts on Monday and the same code draws both.
 *
 * A cell can carry more than one kind — half a day of vacation and half of ROL is a real day — so
 * `kinds` is a list, in the order `LEAVE_DAY_KINDS` declares, and the legend colours them in that
 * same order.
 */
export function calendar(
  year: number,
  days: readonly LeaveDayView[],
  holidays: ReadonlySet<CivilDate>,
  weekStart: number,
  countedThrough: MonthKey | null,
  minutesPerDay: number,
): CalendarMonth[] {
  const byDate = new Map<CivilDate, LeaveDayKind[]>();
  const weightByDate = new Map<CivilDate, number>();
  for (const day of days) {
    if (Number(day.on.slice(0, 4)) !== year) continue;
    const kinds = byDate.get(day.on) ?? [];
    kinds.push(day.kind);
    byDate.set(day.on, kinds);
    weightByDate.set(day.on, (weightByDate.get(day.on) ?? 0) + minuteWeight(day, minutesPerDay));
  }

  const months: CalendarMonth[] = [];
  for (let month = 1; month <= 12; month += 1) {
    const first = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
    const lead = (dayOfWeek(first) - weekStart + 7) % 7;
    const cells: CalendarCell[] = Array.from({ length: lead }, () => blank());
    for (let date = first; Number(date.slice(5, 7)) === month; date = addDays(date, 1)) {
      const kinds = (byDate.get(date) ?? []).slice().sort(byDeclaredOrder);
      cells.push({
        date,
        kinds,
        status: kinds.length === 0 ? null : dayStatus(date, countedThrough),
        weekend: isWeekend(date),
        holiday: holidays.has(date),
        partial: kinds.length > 0 && (weightByDate.get(date) ?? 0) < minutesPerDay,
      });
    }
    while (cells.length % 7 !== 0) cells.push(blank());
    const weeks: CalendarCell[][] = [];
    for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
    months.push({ month, weeks });
  }
  return months;
}

function blank(): CalendarCell {
  return { date: null, kinds: [], status: null, weekend: false, holiday: false, partial: false };
}

export function byDeclaredOrder(a: LeaveDayKind, b: LeaveDayKind): number {
  return LEAVE_DAY_KINDS.indexOf(a) - LEAVE_DAY_KINDS.indexOf(b);
}
