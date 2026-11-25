// The page of one leave year (spec §7.9; types since R5g): every figure the screen, the API and
// the tools read, worked out once. One balance per type with an allowance, in the person's order.
import { type LeaveBalanceSource, leaveBalances } from "./ports";
import { getPreferences } from "../users/service";
import type { Ctx } from "../../platform/context";
import type { leaveDays } from "./schema";
import { type CivilDate, type MonthKey, addMonths, monthKey, today } from "../../shared/dates";
import {
  type AccrualView,
  type ForecastInput,
  type Overdrawn,
  type YearWindow,
  accrualView,
  forecastOpening,
  monthlyRate,
  overdrawn,
} from "./accrual";
import {
  type LeaveDayView,
  type MonthBar,
  type MonthGroup,
  type ResidualInput,
  type ResidualView,
  type UnrecordedLeave,
  type YearTotals,
  dayStatus,
  daysToMinutes,
  monthBars,
  monthGroups,
  residual,
  stillBooked,
  unrecordedLeave,
  yearTotals,
} from "./rules";
import {
  type LeaveDay,
  type LeaveTypeView,
  type TypeAllowance,
  leaveContext,
  leaveYearWindow,
  listLeaveDays,
  listTypeAllowances,
  yearsOf,
} from "./service";

/** One row of the "Leave days" table: either a day of ours or a month a payslip reported. */
export type LeaveRow =
  | {
      source: "day";
      id: string;
      on: CivilDate;
      typeId: string;
      /** Half a day or a whole one; for a type counted in hours, the nearest of the two. */
      fraction: number;
      minutes: number | null;
      note: string | null;
      origin: (typeof leaveDays.$inferSelect)["origin"];
      status: "taken" | "planned";
      /** What the next pass of the calendar still owes this row, for the badge that says so. */
      pending: "none" | "upsert" | "delete";
    }
  | {
      source: "payroll";
      id: string;
      usagePeriod: MonthKey;
      /** The word the payslip printed the use under. */
      kind: string;
      /** The type it counts against; `null` when no type of the person's has its balance. */
      typeId: string | null;
      hours: number;
      payrollPeriod: MonthKey;
    };

/** What a type with an allowance comes to in the year: its residual and its forecast. */
export interface TypeBalance {
  typeId: string;
  residual: ResidualView;
  allowanceMinutes: number | null;
  carriedMinutes: number;
  residualInput: ResidualInput;
  forecastInput: ForecastInput;
  accrual: AccrualView;
}

interface TimeOffView {
  year: number;
  today: CivilDate;
  minutesPerDay: number;
  weekStart: number;
  /** The days of the week the person works, 0 Sunday … 6 Saturday. */
  workDays: number[];
  /** The month the leave year starts in; `window` are its days. */
  yearStartMonth: number;
  window: YearWindow;
  types: LeaveTypeView[];
  /** What the person stated for the year, by type. */
  allowances: TypeAllowance[];
  balances: TypeBalance[];
  bars: MonthBar[];
  rows: LeaveRow[];
  years: number[];
  unrecorded: UnrecordedLeave[];
  overdrawn: Overdrawn[];
  totals: YearTotals;
  countedThrough: MonthKey | null;
  months: MonthGroup[];
  holidays: CivilDate[];
  /** Without a calendar of holidays only the working week is known: the screen says so. */
  hasHolidayCalendar: boolean;
}

const asView = (day: LeaveDay): LeaveDayView => ({
  on: day.on,
  typeId: day.typeId ?? "",
  fraction: Number(day.fraction),
  minutes: day.minutes,
});

type Snapshot = Awaited<ReturnType<LeaveBalanceSource["snapshotHistory"]>>[number];

const lastOf = (snapshots: readonly Snapshot[], key: string) => {
  const last = snapshots.filter((one) => one.kind === key && one.remainingHours !== null).at(-1);
  return last ? { period: last.period as MonthKey, remainingHours: last.remainingHours as number } : null;
};

/**
 * The page of one leave year (spec §7.9). `year` is the year the leave year starts in: with the
 * default start in January, the calendar year.
 */
export async function timeOffView(ctx: Pick<Ctx, "userId" | "timeZone">, year: number): Promise<TimeOffView> {
  const preferences = await getPreferences(ctx);
  const first = await leaveContext(ctx, [year]);
  const window = leaveYearWindow(year, first.settings.yearStartMonth);
  const { types, settings, holidays, hasHolidayCalendar } =
    window.to.slice(0, 4) === String(year) ? first : await leaveContext(ctx, yearsOf(window));
  const inWindow = (date: string) => date >= window.from && date <= window.to;

  const history = await leaveBalances().snapshotHistory(ctx);
  const snapshots = history.filter((one) => inWindow(monthKey(one.period)));
  const balanced = types.filter((type) => type.hasAllowance);
  const openings = new Map(
    balanced.map((type) => [
      type.id,
      forecastOpening(type.balanceKey === null ? null : lastOf(history, type.balanceKey), window),
    ]),
  );

  const from = [window.from, ...[...openings.values()].map((one) => one.spentFrom)].sort()[0];
  const [everyAllowance, everyDay, ...eventsByYear] = await Promise.all([
    listTypeAllowances(ctx),
    listLeaveDays(ctx, { from, to: window.to }),
    ...yearsOf(window).map((one) => leaveBalances().eventsOf(ctx, one)),
  ]);
  const events = eventsByYear.flat().filter((event) => inWindow(event.usagePeriod));
  const allowances = everyAllowance.filter((one) => one.year === year);
  const days = everyDay.filter((day) => day.on >= window.from);

  const todayOn = today(preferences.timeZone);
  const minutesPerDay = preferences.minutesPerDay;
  const views = days.filter(stillBooked).map(asView);

  const newest = snapshots.at(-1) ?? null;
  const countedThrough: MonthKey | null = newest === null ? null : addMonths(monthKey(newest.period), -1);
  // A year with no payslip: a day before today is taken (R5g decision 3 = A).
  const statusToday = countedThrough === null ? todayOn : null;

  const balances: TypeBalance[] = balanced.map((type) => {
    const stated = allowances.find((one) => one.typeId === type.id);
    const allowanceMinutes = stated?.days == null ? null : daysToMinutes(stated.days, minutesPerDay);
    const key = type.balanceKey;
    // The payslip's A.P. wins; what the person stated counts only without one (R5g decision 4 = A).
    const printed =
      key === null
        ? undefined
        : snapshots.filter((one) => one.kind === key && one.previousYearHours !== null).at(-1);
    const carriedMinutes =
      printed !== undefined
        ? Math.round((printed.previousYearHours as number) * 60)
        : stated?.carriedDays == null
          ? 0
          : daysToMinutes(stated.carriedDays, minutesPerDay);
    const residualInput: ResidualInput = {
      snapshot: key === null ? null : lastOf(snapshots, key),
      allowanceMinutes,
      carriedMinutes,
      days: views.filter((day) => day.typeId === type.id),
      countedThrough,
      today: statusToday,
      minutesPerDay,
    };
    const opening = openings.get(type.id) as ForecastInput["opening"];
    const forecastInput: ForecastInput = {
      rate: monthlyRate(key === null ? [] : history.filter((one) => one.kind === key), allowanceMinutes),
      opening,
      days: everyDay
        .filter((day) => stillBooked(day) && day.typeId === type.id && day.on >= opening.spentFrom)
        .map(asView),
      minutesPerDay,
    };
    const view = residual(residualInput);
    return {
      typeId: type.id,
      residual: view,
      allowanceMinutes,
      carriedMinutes,
      residualInput,
      forecastInput,
      accrual: accrualView(forecastInput, window, view.basis),
    };
  });

  const typeOfBalance = (key: string) => types.find((type) => type.balanceKey === key)?.id ?? null;
  const rows: LeaveRow[] = [
    ...days.map((day): LeaveRow => ({
      source: "day",
      id: day.id,
      on: day.on,
      typeId: day.typeId,
      fraction: Number(day.fraction),
      minutes: day.minutes,
      note: day.note,
      origin: day.origin,
      status: dayStatus(day.on, countedThrough, statusToday),
      pending: day.pending,
    })),
    ...events.map((event, index): LeaveRow => ({
      source: "payroll",
      id: `payroll-${event.usagePeriod}-${event.kind}-${index}`,
      usagePeriod: event.usagePeriod,
      kind: event.kind,
      typeId: typeOfBalance(event.balance),
      hours: event.hours,
      payrollPeriod: event.payrollPeriod,
    })),
  ].sort(byDateThenType(types.map((type) => type.id)));

  const options = { today: statusToday, startMonth: settings.yearStartMonth };
  return {
    year,
    today: todayOn,
    minutesPerDay,
    weekStart: preferences.weekStart,
    workDays: settings.workDays,
    yearStartMonth: settings.yearStartMonth,
    window,
    types,
    allowances,
    balances,
    bars: monthBars(views, year, minutesPerDay, countedThrough, options),
    rows,
    years: yearsOffered(
      year,
      everyAllowance.map((one) => one.year),
    ),
    unrecorded: unrecordedLeave(events, views, minutesPerDay, types),
    overdrawn: balances
      .map((balance) =>
        overdrawn(balance.typeId, {
          view: balance.residual,
          forecast: balance.forecastInput,
          carriedMinutes: balance.carriedMinutes,
          window,
          planned: balance.residualInput.days.filter(
            (day) => dayStatus(day.on, countedThrough, statusToday) === "planned",
          ),
          taken: balance.residualInput.days.filter(
            (day) => dayStatus(day.on, countedThrough, statusToday) === "taken",
          ),
        }),
      )
      .filter((one): one is Overdrawn => one !== null),
    totals: yearTotals(views, countedThrough, minutesPerDay, types, statusToday),
    countedThrough,
    months: monthGroups(year, views, events, countedThrough, minutesPerDay, types, options),
    holidays: [...holidays].filter(inWindow).sort(),
    hasHolidayCalendar,
  };
}

function keyOf(row: LeaveRow): string {
  return row.source === "day" ? row.on : row.usagePeriod;
}

/** By date, a payslip's month before the days of it, then by the person's order of the types. */
function byDateThenType(order: readonly string[]) {
  return (a: LeaveRow, b: LeaveRow): number => {
    const left = keyOf(a);
    const right = keyOf(b);
    if (left !== right) return left < right ? -1 : 1;
    if (a.source !== b.source) return a.source === "payroll" ? -1 : 1;
    if (a.source === "payroll" && b.source === "payroll")
      return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
    return order.indexOf(a.typeId ?? "") - order.indexOf(b.typeId ?? "");
  };
}

/** The years the switcher offers: this one, the one shown, and every year with an allowance. */
function yearsOffered(shown: number, stated: readonly number[]): number[] {
  const current = Number(new Date().toISOString().slice(0, 4));
  return [...new Set([current, shown, ...stated])].sort((a, b) => a - b);
}
