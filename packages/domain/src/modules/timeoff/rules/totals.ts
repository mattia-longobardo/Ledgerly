import { type CivilDate, type MonthKey, monthKey } from "../../../shared/dates";
import { dayStatus, minuteWeight, type LeaveDayView, type LeaveType } from "./days";
import { leaveYearMonths } from "./residual";

/* Leave the payslips know about and the calendar does not (M2) */

/** A month where the payslip counted more leave of a type than the days recorded here add up to. */
export interface UnrecordedLeave {
  /** The month the hours were used in. */
  month: MonthKey;
  typeId: string;
  payrollMinutes: number;
  recordedMinutes: number;
  missingMinutes: number;
}

/** A payslip's leave event, as `payroll` reports it: `balance` is the balance word it counts against. */
interface PayrollLeave {
  balance: string;
  hours: number;
  usagePeriod: MonthKey;
}

/** Rounding in two different units meets somewhere: a minute of daylight between them is not news. */
const UNRECORDED_TOLERANCE_MINUTES = 1;

type BalanceTypes = readonly Pick<LeaveType, "id" | "balanceKey">[];

/** The type a payslip's balance word belongs to, among the person's types. */
function typeOfBalance(types: BalanceTypes, kind: string): string | null {
  return types.find((type) => type.balanceKey === kind)?.id ?? null;
}

/**
 * The months where a payslip says more leave of a type was used than this calendar accounts for
 * (M2). The payslip is the employer's own count and arrives a month late; a day taken and never
 * written down here shows up as the difference. Only that direction is reported: more recorded
 * than the payslip counted is the ordinary state of a month whose payslip has not come yet.
 */
export function unrecordedLeave(
  events: readonly PayrollLeave[],
  days: readonly LeaveDayView[],
  minutesPerDay: number,
  types: BalanceTypes,
): UnrecordedLeave[] {
  const key = (month: MonthKey, typeId: string) => `${month}\u0000${typeId}`;
  const counted = new Set(types.filter((type) => type.balanceKey !== null).map((type) => type.id));

  const payroll = new Map<string, number>();
  for (const event of events) {
    const typeId = typeOfBalance(types, event.balance);
    if (typeId === null) continue;
    const at = key(event.usagePeriod, typeId);
    payroll.set(at, (payroll.get(at) ?? 0) + Math.round(event.hours * 60));
  }

  const recorded = new Map<string, number>();
  for (const day of days) {
    if (!counted.has(day.typeId)) continue;
    const at = key(monthKey(day.on), day.typeId);
    recorded.set(at, (recorded.get(at) ?? 0) + minuteWeight(day, minutesPerDay));
  }

  const order = types.map((type) => type.id);
  const gaps: UnrecordedLeave[] = [];
  for (const [at, payrollMinutes] of payroll) {
    const [month, typeId] = at.split("\u0000");
    const recordedMinutes = recorded.get(at) ?? 0;
    const missingMinutes = payrollMinutes - recordedMinutes;
    if (missingMinutes <= UNRECORDED_TOLERANCE_MINUTES) continue;
    gaps.push({ month, typeId, payrollMinutes, recordedMinutes, missingMinutes });
  }
  return gaps.sort((a, b) =>
    a.month === b.month ? order.indexOf(a.typeId) - order.indexOf(b.typeId) : a.month < b.month ? -1 : 1,
  );
}

/* What the year adds up to (N5) */

/** Minutes of one type. */
export interface TypeMinutes {
  typeId: string;
  minutes: number;
}

/** Every type's share of a year, in minutes, split the way the cards split everything else. */
export interface YearTotals {
  takenMinutes: number;
  plannedMinutes: number;
  totalMinutes: number;
  /** Per type, in the person's order, and only the types that have something. */
  byType: TypeMinutes[];
}

/**
 * Every day off of the year, all types together (N5): what has been taken, what is planned, and
 * what the two come to. All types and not just the ones with an allowance: the question this
 * answers is "how much was I away this year".
 */
export function yearTotals(
  days: readonly LeaveDayView[],
  countedThrough: MonthKey | null,
  minutesPerDay: number,
  types: readonly Pick<LeaveType, "id">[],
  today: CivilDate | null = null,
): YearTotals {
  let takenMinutes = 0;
  let plannedMinutes = 0;
  const perType = new Map<string, number>();

  for (const day of days) {
    const minutes = minuteWeight(day, minutesPerDay);
    if (dayStatus(day.on, countedThrough, today) === "taken") takenMinutes += minutes;
    else plannedMinutes += minutes;
    perType.set(day.typeId, (perType.get(day.typeId) ?? 0) + minutes);
  }

  return {
    takenMinutes,
    plannedMinutes,
    totalMinutes: takenMinutes + plannedMinutes,
    byType: types
      .filter((type) => (perType.get(type.id) ?? 0) > 0)
      .map((type) => ({ typeId: type.id, minutes: perType.get(type.id) as number })),
  };
}

/* The year, month by month (N7) */

/** What one month of the leave table has to say for itself. */
export interface MonthGroup {
  month: MonthKey;
  /**
   * What the payslips counted for this month, in minutes per type — the employer's own figure.
   * `null` when no payslip covers the month yet, which for a month still to come is the normal
   * state and not a gap.
   */
  payroll: TypeMinutes[] | null;
  /** What this calendar holds for the month, per type with something, whatever the payslips say. */
  recorded: TypeMinutes[];
  /** Of the recorded minutes, the ones no payslip has counted yet. */
  plannedMinutes: number;
  /** Whether the payslip counted more than is recorded — the gap M2 warns about. */
  missingMinutes: number;
  /** `true` once a payslip covers the month: what makes "planned" mean "not yet counted". */
  counted: boolean;
}

/** Adds minutes to a type's entry of a list, in the person's order. */
function add(list: TypeMinutes[], order: readonly string[], typeId: string, minutes: number): void {
  const entry = list.find((one) => one.typeId === typeId);
  if (entry) entry.minutes += minutes;
  else list.push({ typeId, minutes });
  list.sort((a, b) => order.indexOf(a.typeId) - order.indexOf(b.typeId));
}

/**
 * The twelve months of a leave year as the leave table groups them (N7). All twelve, always: a
 * month with nothing in it still says what the payslip expected. Each group carries both sides —
 * what the employer counted and what is written down here — so a person can see them disagree.
 */
export function monthGroups(
  year: number,
  days: readonly LeaveDayView[],
  events: readonly PayrollLeave[],
  countedThrough: MonthKey | null,
  minutesPerDay: number,
  types: BalanceTypes,
  options: { today?: CivilDate | null; startMonth?: number } = {},
): MonthGroup[] {
  const months = leaveYearMonths(year, options.startMonth);
  const order = types.map((type) => type.id);
  const counted = new Set(types.filter((type) => type.balanceKey !== null).map((type) => type.id));
  const groups: MonthGroup[] = months.map((month) => ({
    month,
    payroll: null,
    recorded: [],
    plannedMinutes: 0,
    missingMinutes: 0,
    counted: countedThrough !== null && month.slice(0, 7) <= countedThrough.slice(0, 7),
  }));

  for (const event of events) {
    const index = months.indexOf(monthKey(event.usagePeriod));
    const typeId = typeOfBalance(types, event.balance);
    if (index < 0 || typeId === null) continue;
    const group = groups[index];
    group.payroll ??= [];
    add(group.payroll, order, typeId, Math.round(event.hours * 60));
  }

  for (const day of days) {
    const index = months.indexOf(monthKey(day.on));
    if (index < 0) continue;
    const group = groups[index];
    const minutes = minuteWeight(day, minutesPerDay);
    add(group.recorded, order, day.typeId, minutes);
    if (dayStatus(day.on, countedThrough, options.today ?? null) === "planned")
      group.plannedMinutes += minutes;
  }

  for (const group of groups) {
    if (group.payroll === null) continue;
    const expected = group.payroll.reduce((sum, one) => sum + one.minutes, 0);
    const held = group.recorded
      .filter((one) => counted.has(one.typeId))
      .reduce((sum, one) => sum + one.minutes, 0);
    group.missingMinutes = Math.max(0, expected - held);
  }
  return groups;
}
