import { type CivilDate, type MonthKey, addDays, dayOfWeek } from "../../../shared/dates";
import {
  byTypeOrder,
  dayStatus,
  DEFAULT_WORK_DAYS,
  isRestDay,
  minuteWeight,
  type DayStatus,
  type LeaveDayView,
  type LeaveType,
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
  /** Every local day of this type in the year. */
  days: readonly LeaveDayView[];
  /** The last month of use an applied payslip accounts for; `null` when there is none. */
  countedThrough: MonthKey | null;
  /** Today, for a year with no payslip: a day before it is taken (R5g decision 3 = A). */
  today?: CivilDate | null;
  minutesPerDay: number;
}

/**
 * A residual, always in **minutes** (plan F7 §3.4.4).
 *
 * Minutes and not days, because days are the coarser of the two units: a balance of 3½ hours
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
  const today = input.today ?? null;

  const weigh = (subset: readonly LeaveDayView[]): number =>
    subset.reduce((sum, day) => sum + minuteWeight(day, minutesPerDay), 0);
  const taken = days.filter((day) => dayStatus(day.on, countedThrough, today) === "taken");
  const planned = days.filter((day) => dayStatus(day.on, countedThrough, today) === "planned");
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
  /** 1–12: the month of the calendar. */
  month: number;
  /** Minutes, like every other total here; the chart divides for its labels. */
  takenMinutes: number;
  plannedMinutes: number;
}

/** The twelve months of a leave year, in order, as "YYYY-MM-01" (R5g: the year may start in any month). */
export function leaveYearMonths(year: number, startMonth = 1): MonthKey[] {
  return Array.from({ length: 12 }, (_, index) => {
    const at = startMonth - 1 + index;
    const y = year + Math.floor(at / 12);
    return `${String(y).padStart(4, "0")}-${String((at % 12) + 1).padStart(2, "0")}-01`;
  });
}

/**
 * Twelve bars, one per month of the leave year, always all twelve: a month with nothing in it is a
 * gap in the chart, not a missing bar. Taken and planned are kept apart because the design stacks them.
 */
export function monthBars(
  days: readonly LeaveDayView[],
  year: number,
  minutesPerDay: number,
  countedThrough: MonthKey | null,
  options: { today?: CivilDate | null; startMonth?: number } = {},
): MonthBar[] {
  const months = leaveYearMonths(year, options.startMonth);
  const bars: MonthBar[] = months.map((month) => ({
    month: Number(month.slice(5, 7)),
    takenMinutes: 0,
    plannedMinutes: 0,
  }));
  for (const day of days) {
    const index = months.indexOf(`${day.on.slice(0, 7)}-01`);
    if (index < 0) continue;
    const bar = bars[index];
    const weight = minuteWeight(day, minutesPerDay);
    if (dayStatus(day.on, countedThrough, options.today ?? null) === "taken") bar.takenMinutes += weight;
    else bar.plannedMinutes += weight;
  }
  return bars;
}

/* The twelve calendar grids of the design */

export interface CalendarCell {
  date: CivilDate | null;
  /** The types of the day, in the person's order; empty for a day with nothing on it. */
  typeIds: string[];
  status: DayStatus | null;
  /** A day of the week the person does not work. */
  weekend: boolean;
  holiday: boolean;
  /** Less than a whole day off: the cell is drawn half-filled rather than merely paler. */
  partial: boolean;
}

export interface CalendarMonth {
  /** 1–12: the month of the calendar. */
  month: number;
  /** The month's own year: a leave year that does not start in January spans two. */
  year: number;
  /** Whole weeks, padded with `date: null` at both ends. */
  weeks: CalendarCell[][];
}

/** What the twelve grids are drawn from, besides the days and the holidays. */
export interface CalendarContext {
  /** 0 Sunday … 6 Saturday: the first column. */
  weekStart: number;
  countedThrough: MonthKey | null;
  minutesPerDay: number;
  /** The person's types, in their order: the order a cell lists its types in. */
  types: readonly Pick<LeaveType, "id">[];
  workDays?: readonly number[];
  today?: CivilDate | null;
  startMonth?: number;
}

/**
 * The leave year as twelve grids of whole weeks, from its first month. A cell can carry more than
 * one type — half a day of two types is a real day — so `typeIds` is a list, in the person's order,
 * and the legend colours them in that same order.
 */
export function calendar(
  year: number,
  days: readonly LeaveDayView[],
  holidays: ReadonlySet<CivilDate>,
  context: CalendarContext,
): CalendarMonth[] {
  const { weekStart, countedThrough, minutesPerDay } = context;
  const workDays = context.workDays ?? DEFAULT_WORK_DAYS;
  const order = byTypeOrder(context.types);
  const months = leaveYearMonths(year, context.startMonth);
  const byDate = new Map<CivilDate, string[]>();
  const weightByDate = new Map<CivilDate, number>();
  for (const day of days) {
    if (!months.includes(`${day.on.slice(0, 7)}-01`)) continue;
    byDate.set(day.on, [...(byDate.get(day.on) ?? []), day.typeId]);
    weightByDate.set(day.on, (weightByDate.get(day.on) ?? 0) + minuteWeight(day, minutesPerDay));
  }

  return months.map((first) => {
    const month = Number(first.slice(5, 7));
    const lead = (dayOfWeek(first) - weekStart + 7) % 7;
    const cells: CalendarCell[] = Array.from({ length: lead }, () => blank());
    for (let date = first; Number(date.slice(5, 7)) === month; date = addDays(date, 1)) {
      const typeIds = (byDate.get(date) ?? []).slice().sort(order);
      cells.push({
        date,
        typeIds,
        status: typeIds.length === 0 ? null : dayStatus(date, countedThrough, context.today ?? null),
        weekend: isRestDay(date, workDays),
        holiday: holidays.has(date),
        partial: typeIds.length > 0 && (weightByDate.get(date) ?? 0) < minutesPerDay,
      });
    }
    while (cells.length % 7 !== 0) cells.push(blank());
    const weeks: CalendarCell[][] = [];
    for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
    return { month, year: Number(first.slice(0, 4)), weeks };
  });
}

function blank(): CalendarCell {
  return { date: null, typeIds: [], status: null, weekend: false, holiday: false, partial: false };
}
