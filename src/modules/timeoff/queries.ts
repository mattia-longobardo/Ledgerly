import "server-only";
import { leaveEventsOf, leaveSnapshotsOf } from "@/modules/payroll/service";
import { holidaysFor } from "@/platform/holidays/service";
import { trekStatsOf } from "@/platform/integrations/trek/sync";
import { getPreferences } from "@/modules/users/service";
import type { Ctx } from "@/platform/context";
import { type CivilDate, type MonthKey, addMonths, monthKey, today } from "@/platform/dates";
import {
  type CalendarMonth,
  type LeaveDayKind,
  type LeaveDayView,
  type MonthBar,
  type Overdrawn,
  type ResidualView,
  type MonthGroup,
  type UnrecordedLeave,
  type YearTotals,
  calendar,
  dayStatus,
  daysToMinutes,
  allowanceMismatchDays,
  monthBars,
  monthGroups,
  overdrawn,
  workingDaysOf,
  residual,
  unrecordedLeave,
  yearTotals,
} from "./rules";
import {
  type Allowance,
  type LeaveDay,
  allowanceOf,
  listAllowances,
  listLeaveDays,
  yearWindow,
} from "./service";

/** One row of the "Leave days" table: either a day of ours or a month a payslip reported. */
export type LeaveRow =
  | {
      source: "day";
      id: string;
      on: CivilDate;
      kind: LeaveDayKind;
      /** Half a day or a whole one, every kind alike (N0). */
      fraction: number;
      note: string | null;
      origin: "manual" | "trek";
      status: "taken" | "planned";
      /** What the next Trek pass still owes this row, for the badge that says so. */
      pending: "none" | "upsert" | "delete";
    }
  | {
      source: "payroll";
      id: string;
      /** The month the hours were used in — a payslip reports a month, never a day (§3.6.1). */
      usagePeriod: MonthKey;
      kind: "vacation" | "rol" | "permit";
      hours: number;
      /** The payslip that reported it, for the note column. */
      payrollPeriod: MonthKey;
    };

/** One of the two headline cards. Both kinds are granted in days (N9) and held here in minutes. */
export interface KindView {
  residual: ResidualView;
  /** The stated allowance in minutes; `null` when nobody has stated one. */
  allowanceMinutes: number | null;
  /** What the payslip carried over from the years before, in minutes (N9); `0` when none says. */
  carriedMinutes: number;
}

export interface TimeOffView {
  year: number;
  today: CivilDate;
  minutesPerDay: number;
  weekStart: number;
  allowance: Allowance | null;
  vacation: KindView;
  rol: KindView;
  bars: MonthBar[];
  calendar: CalendarMonth[];
  rows: LeaveRow[];
  /** The years that have something in them, so the picker offers only real years. */
  years: number[];
  /**
   * What Trek last said about this year, when there is a Trek link and its last pass covered it.
   * Shown **beside** our figures and never folded into them: Trek honours a leave-year window
   * (calendar, fiscal or anniversary) this app does not model (plan F7 §3.6.4).
   */
  trek: { used: number; remaining: number; totalAvailable: number } | null;
  /** Months whose payslip counted more leave than the days here add up to (M2). */
  unrecorded: UnrecordedLeave[];
  /** Kinds booked past what was left, measured against whatever the residual used (N5b). */
  overdrawn: Overdrawn[];
  /** The whole year's days off, all kinds together (N5). */
  totals: YearTotals;
  /** The last month of use an applied payslip accounts for; `null` when there is none (N2). */
  countedThrough: MonthKey | null;
  /** The year month by month, as the table groups it (N7). */
  months: MonthGroup[];
  /** The days a year grants altogether, in minutes; `null` when nobody has stated one (N7). */
  totalAllowanceMinutes: number | null;
  /** How far the two parts are from that total, in days; `null` when there is nothing to compare. */
  allowanceMismatch: number | null;
}

const asView = (day: LeaveDay): LeaveDayView => ({
  on: day.on,
  kind: day.kind,
  fraction: Number(day.fraction),
});

/**
 * Everything the Time off screen shows for one year, assembled once (spec §7.9).
 *
 * The payslip snapshots come through `payroll`'s own service, never its tables, and the residual
 * is worked out twice — once per kind — because the two have different units and may well have
 * different provenance: a payslip that prints a vacation balance and no ROL one leaves the ROL
 * card on the allowance formula while vacation is on the payslip's.
 */
export async function timeOffView(ctx: Pick<Ctx, "userId" | "timeZone">, year: number): Promise<TimeOffView> {
  const [preferences, allowance, allowances, days, snapshots, events, trek] = await Promise.all([
    getPreferences(ctx),
    allowanceOf(ctx, year),
    listAllowances(ctx),
    listLeaveDays(ctx, yearWindow(year)),
    leaveSnapshotsOf(ctx, year),
    leaveEventsOf(ctx, year),
    trekStatsOf(ctx, year),
  ]);

  // The days this person does not work, from the calendars they keep (M3).
  const holidays = await holidaysFor(ctx, [year], preferences.patronSaint);

  const todayOn = today(preferences.timeZone);
  const minutesPerDay = preferences.minutesPerDay;
  const views = days.map(asView);

  // The last applied payslip that printed a balance for this kind: the latest month wins, and the
  // read already gave them oldest first.
  const lastSnapshot = (kind: "vacation" | "rol") => {
    const matching = snapshots.filter((one) => one.kind === kind && one.remainingHours !== null);
    const last = matching.at(-1);
    return last ? { period: last.period as MonthKey, remainingHours: last.remainingHours as number } : null;
  };

  /**
   * How far the payslips have counted: the newest applied one, minus a month, because a payslip
   * accounts for the month before its own (spec §7.8). This is what decides taken from planned
   * everywhere on the screen (N2), so it is worked out once.
   */
  const newest = snapshots.at(-1) ?? null;
  const countedThrough: MonthKey | null = newest === null ? null : addMonths(monthKey(newest.period), -1);

  // Both kinds are granted in days since N9; minutes is the unit every total below is held in.
  const vacationMinutes =
    allowance?.vacationDays == null ? null : daysToMinutes(Number(allowance.vacationDays), minutesPerDay);
  const rolMinutes =
    allowance?.rolDays == null ? null : daysToMinutes(Number(allowance.rolDays), minutesPerDay);

  /**
   * What the years before left over, from the payslip's own A.P. column (N9).
   *
   * Nobody is asked for this figure any more: the employer prints it, and a second answer typed
   * into a form could only ever disagree with the first. The newest payslip that states it wins —
   * a rectification restates A.P. just as it restates everything else.
   */
  const carriedOf = (kind: "vacation" | "rol"): number => {
    const stated = snapshots.filter((one) => one.kind === kind && one.previousYearHours !== null);
    const last = stated.at(-1);
    return last === undefined ? 0 : Math.round((last.previousYearHours as number) * 60);
  };
  const carriedMinutes = carriedOf("vacation");
  const carriedRolMinutes = carriedOf("rol");

  // The days this person actually works: the denominator of the accrual, and what a booked day is
  // measured against, so the two can never be counted over different calendars (N9).
  const workingDays = workingDaysOf(year, holidays);

  /** The days of a kind no payslip has counted yet — the ones an accrual has to cover (N9). */
  const plannedOf = (kind: "vacation" | "rol") =>
    views.filter((day) => day.kind === kind && dayStatus(day.on, countedThrough) === "planned");

  const vacation: KindView = {
    residual: residual({
      snapshot: lastSnapshot("vacation"),
      allowanceMinutes: vacationMinutes,
      carriedMinutes,
      days: views.filter((day) => day.kind === "vacation"),
      countedThrough,
      minutesPerDay,
    }),
    allowanceMinutes: vacationMinutes,
    carriedMinutes,
  };

  const rol: KindView = {
    residual: residual({
      snapshot: lastSnapshot("rol"),
      allowanceMinutes: rolMinutes,
      // ROL rolls over like vacation does (N1), and like vacation the figure is the payslip's (N9).
      carriedMinutes: carriedRolMinutes,
      days: views.filter((day) => day.kind === "rol"),
      countedThrough,
      minutesPerDay,
    }),
    allowanceMinutes: rolMinutes,
    carriedMinutes: carriedRolMinutes,
  };

  const rows: LeaveRow[] = [
    ...days.map((day): LeaveRow => ({
      source: "day",
      id: day.id,
      on: day.on,
      kind: day.kind,
      fraction: Number(day.fraction),
      note: day.note,
      origin: day.origin,
      status: dayStatus(day.on, countedThrough),
      pending: day.pending,
    })),
    ...events.map((event, index): LeaveRow => ({
      source: "payroll",
      id: `payroll-${event.usagePeriod}-${event.kind}-${index}`,
      usagePeriod: event.usagePeriod,
      kind: event.kind,
      hours: event.hours,
      payrollPeriod: event.payrollPeriod,
    })),
  ].sort(byDateThenKind);

  return {
    year,
    today: todayOn,
    minutesPerDay,
    weekStart: preferences.weekStart,
    allowance,
    vacation,
    rol,
    bars: monthBars(views, year, minutesPerDay, countedThrough),
    calendar: calendar(year, views, holidays, preferences.weekStart, countedThrough, minutesPerDay),
    rows,
    years: yearsOffered(
      year,
      allowances.map((one) => one.year),
    ),
    trek,
    unrecorded: unrecordedLeave(events, views, minutesPerDay),
    overdrawn: [
      overdrawn("vacation", {
        view: vacation.residual,
        allowanceMinutes: vacationMinutes,
        carriedMinutes,
        workingDays,
        planned: plannedOf("vacation"),
        minutesPerDay,
      }),
      overdrawn("rol", {
        view: rol.residual,
        allowanceMinutes: rolMinutes,
        carriedMinutes: carriedRolMinutes,
        workingDays,
        planned: plannedOf("rol"),
        minutesPerDay,
      }),
    ].filter((one): one is Overdrawn => one !== null),
    totals: yearTotals(views, countedThrough, minutesPerDay),
    countedThrough,
    months: monthGroups(year, views, events, countedThrough, minutesPerDay),
    totalAllowanceMinutes:
      allowance?.totalDays == null ? null : daysToMinutes(Number(allowance.totalDays), minutesPerDay),
    allowanceMismatch: allowanceMismatchDays({
      totalDays: allowance?.totalDays == null ? null : Number(allowance.totalDays),
      vacationDays: allowance?.vacationDays == null ? null : Number(allowance.vacationDays),
      rolDays: allowance?.rolDays == null ? null : Number(allowance.rolDays),
    }),
  };
}

/** A payslip month sorts as its first day, which is where the month row belongs in the table. */
function keyOf(row: LeaveRow): string {
  return row.source === "day" ? row.on : row.usagePeriod;
}

function byDateThenKind(a: LeaveRow, b: LeaveRow): number {
  const left = keyOf(a);
  const right = keyOf(b);
  if (left !== right) return left < right ? -1 : 1;
  // A payslip's month row sits above the days of that month: it is the wider statement.
  if (a.source !== b.source) return a.source === "payroll" ? -1 : 1;
  return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
}

/**
 * Which years the picker offers, oldest first: the one being shown, the one we are in, and every
 * year the user has stated an allowance for. Not a bare range around today — a year nobody has
 * put anything in is a year with nothing to show.
 */
export function yearsOffered(shown: number, stated: readonly number[]): number[] {
  const current = Number(new Date().toISOString().slice(0, 4));
  return [...new Set([current, shown, ...stated])].sort((a, b) => a - b);
}
