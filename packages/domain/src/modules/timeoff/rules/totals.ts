import { type MonthKey, monthKey } from "../../../shared/dates";
import { LEAVE_DAY_KINDS, dayStatus, minuteWeight, type LeaveDayKind, type LeaveDayView } from "./days";
import type { BalanceKind } from "../ports";

/* Leave the payslips know about and the calendar does not (M2) */

/** A month where the payslip counted more leave than the days recorded here add up to. */
export interface UnrecordedLeave {
  /** The month the hours were used in. */
  month: MonthKey;
  /** The kind as this module names it: a payroll `permit` is our ROL. */
  kind: Extract<LeaveDayKind, "vacation" | "rol">;
  payrollMinutes: number;
  recordedMinutes: number;
  missingMinutes: number;
}

/** A payslip's leave event, as `payroll` reports it. */
interface PayrollLeave {
  kind: BalanceKind;
  hours: number;
  usagePeriod: MonthKey;
}

/** Rounding in two different units meets somewhere: a minute of daylight between them is not news. */
const UNRECORDED_TOLERANCE_MINUTES = 1;

/**
 * The months where a payslip says more leave was used than this calendar accounts for (M2).
 *
 * The payslip is the employer's own count and arrives a month late; a day taken and never written
 * down here shows up as the difference. Only that direction is reported: more recorded than the
 * payslip counted is the ordinary state of a month whose payslip has not come yet, and warning
 * about it would cry wolf every month.
 *
 * A `permit` from the payroll module counts against ROL — that is the kind it is confirmed as
 * (F5) — so the two are compared as one.
 */
export function unrecordedLeave(
  events: readonly PayrollLeave[],
  days: readonly LeaveDayView[],
  minutesPerDay: number,
): UnrecordedLeave[] {
  const key = (month: MonthKey, kind: string) => `${month}\u0000${kind}`;

  const payroll = new Map<string, number>();
  for (const event of events) {
    const kind = event.kind === "vacation" ? "vacation" : "rol";
    const at = key(event.usagePeriod, kind);
    payroll.set(at, (payroll.get(at) ?? 0) + Math.round(event.hours * 60));
  }

  const recorded = new Map<string, number>();
  for (const day of days) {
    if (day.kind !== "vacation" && day.kind !== "rol") continue;
    const at = key(monthKey(day.on), day.kind);
    recorded.set(at, (recorded.get(at) ?? 0) + minuteWeight(day, minutesPerDay));
  }

  const gaps: UnrecordedLeave[] = [];
  for (const [at, payrollMinutes] of payroll) {
    const [month, kind] = at.split("\u0000");
    const recordedMinutes = recorded.get(at) ?? 0;
    const missingMinutes = payrollMinutes - recordedMinutes;
    if (missingMinutes <= UNRECORDED_TOLERANCE_MINUTES) continue;
    gaps.push({
      month,
      kind: kind as "vacation" | "rol",
      payrollMinutes,
      recordedMinutes,
      missingMinutes,
    });
  }
  return gaps.sort((a, b) =>
    a.month === b.month ? a.kind.localeCompare(b.kind) : a.month < b.month ? -1 : 1,
  );
}

/* What the year adds up to (N5) */

/** Every kind's share of a year, in minutes, split the way the cards split everything else. */
export interface YearTotals {
  takenMinutes: number;
  plannedMinutes: number;
  totalMinutes: number;
  /** Per kind, in the order `LEAVE_DAY_KINDS` declares, and only the kinds that have something. */
  byKind: Array<{ kind: LeaveDayKind; minutes: number }>;
}

/**
 * Every day off of the year, all kinds together (N5): what has been taken, what is planned, and
 * what the two come to.
 *
 * All kinds and not just the two that spend an allowance: the question this answers is "how much
 * was I away this year", and a week of sick leave is a week away. The breakdown keeps them apart
 * for anybody who wants the other question.
 */
export function yearTotals(
  days: readonly LeaveDayView[],
  countedThrough: MonthKey | null,
  minutesPerDay: number,
): YearTotals {
  let takenMinutes = 0;
  let plannedMinutes = 0;
  const perKind = new Map<LeaveDayKind, number>();

  for (const day of days) {
    const minutes = minuteWeight(day, minutesPerDay);
    if (dayStatus(day.on, countedThrough) === "taken") takenMinutes += minutes;
    else plannedMinutes += minutes;
    perKind.set(day.kind, (perKind.get(day.kind) ?? 0) + minutes);
  }

  return {
    takenMinutes,
    plannedMinutes,
    totalMinutes: takenMinutes + plannedMinutes,
    byKind: LEAVE_DAY_KINDS.filter((kind) => (perKind.get(kind) ?? 0) > 0).map((kind) => ({
      kind,
      minutes: perKind.get(kind) as number,
    })),
  };
}

/* The year, month by month (N7) */

/** What one month of the leave table has to say for itself. */
export interface MonthGroup {
  month: MonthKey;
  /**
   * What the payslips counted for this month, in minutes per kind — the employer's own figure.
   * `null` when no payslip covers the month yet, which for a month still to come is the normal
   * state and not a gap.
   */
  payroll: { vacationMinutes: number; rolMinutes: number } | null;
  /** What this calendar holds for the month, whatever the payslips say. */
  recorded: { vacationMinutes: number; rolMinutes: number; otherMinutes: number };
  /** Of the recorded minutes, the ones no payslip has counted yet. */
  plannedMinutes: number;
  /** Whether the payslip counted more than is recorded — the gap M2 warns about. */
  missingMinutes: number;
  /** `true` once a payslip covers the month: what makes "planned" mean "not yet counted". */
  counted: boolean;
}

/**
 * The twelve months of a year as the leave table groups them (N7).
 *
 * All twelve, always: a month with nothing in it still says what the payslip expected, and for a
 * month still to come the interesting figure is what is planned. Each group carries both sides —
 * what the employer counted and what is written down here — because the whole point of putting
 * them on one line is that a person can see them disagree.
 */
export function monthGroups(
  year: number,
  days: readonly LeaveDayView[],
  events: readonly PayrollLeave[],
  countedThrough: MonthKey | null,
  minutesPerDay: number,
): MonthGroup[] {
  const groups: MonthGroup[] = Array.from({ length: 12 }, (_, index) => {
    const month = `${String(year).padStart(4, "0")}-${String(index + 1).padStart(2, "0")}-01`;
    return {
      month,
      payroll: null,
      recorded: { vacationMinutes: 0, rolMinutes: 0, otherMinutes: 0 },
      plannedMinutes: 0,
      missingMinutes: 0,
      counted: countedThrough !== null && month.slice(0, 7) <= countedThrough.slice(0, 7),
    };
  });

  const indexOf = (value: string): number | null => {
    if (Number(value.slice(0, 4)) !== year) return null;
    return Number(value.slice(5, 7)) - 1;
  };

  for (const event of events) {
    const index = indexOf(event.usagePeriod);
    if (index === null) continue;
    const group = groups[index];
    const minutes = Math.round(event.hours * 60);
    const payroll = group.payroll ?? { vacationMinutes: 0, rolMinutes: 0 };
    // A payroll `permit` is confirmed as ROL (F5), so the two are counted as one.
    if (event.kind === "vacation") payroll.vacationMinutes += minutes;
    else payroll.rolMinutes += minutes;
    group.payroll = payroll;
  }

  for (const day of days) {
    const index = indexOf(day.on);
    if (index === null) continue;
    const group = groups[index];
    const minutes = minuteWeight(day, minutesPerDay);
    if (day.kind === "vacation") group.recorded.vacationMinutes += minutes;
    else if (day.kind === "rol") group.recorded.rolMinutes += minutes;
    else group.recorded.otherMinutes += minutes;
    if (dayStatus(day.on, countedThrough) === "planned") group.plannedMinutes += minutes;
  }

  for (const group of groups) {
    if (group.payroll === null) continue;
    const expected = group.payroll.vacationMinutes + group.payroll.rolMinutes;
    const held = group.recorded.vacationMinutes + group.recorded.rolMinutes;
    group.missingMinutes = Math.max(0, expected - held);
  }
  return groups;
}
