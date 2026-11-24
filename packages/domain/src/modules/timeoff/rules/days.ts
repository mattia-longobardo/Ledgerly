import { type CivilDate, type MonthKey, dayOfWeek } from "../../../shared/dates";

/* The types of leave are data (rewrite plan R5g, E6) */

/** What one row of a type is: a whole day, a whole or a half day, or a number of hours. */
export const LEAVE_UNITS = ["day", "half_day", "hours"] as const;
export type LeaveUnit = (typeof LEAVE_UNITS)[number];

/** The colours a type may take: tokens of the design system, which hold in both themes. */
export const LEAVE_COLORS = ["primary", "warn", "accent", "neg", "faint", "pos", "muted"] as const;
export type LeaveColor = (typeof LEAVE_COLORS)[number];

/** A type of leave as the rules and the screens read it: a row of `leave_types`. */
export interface LeaveType {
  id: string;
  name: string;
  color: LeaveColor;
  unit: LeaveUnit;
  /** The type has a yearly allowance, and so a residual. */
  hasAllowance: boolean;
  /** Its days go to the external calendar. */
  toCalendar: boolean;
  /** The word a payslip prints this type's balance and use under; null when none does. */
  balanceKey: string | null;
  /** The word the external calendar holds this type's days under; null when it has none of its own. */
  calendarKind: string | null;
}

/**
 * The word a type's days go to the calendar as: the first type, in the person's order, that the
 * calendar has a word for gives it to every type that goes there (N4: one kind on the calendar).
 * `null`: no type has a word, and so nothing goes.
 */
export function calendarWordOf(types: readonly LeaveType[]): string | null {
  return types.find((type) => type.calendarKind !== null)?.calendarKind ?? null;
}

/**
 * What the external calendar last said of a row's day (rewrite plan R5c): `synced` once it was
 * observed holding it, `refused` when it does not take that day. `null`: never told.
 */
export const EXTERNAL_STATES = ["synced", "refused"] as const;

/** What the next pass of the calendar owes this row. `none` means the two agendas agree. */
export const PENDING_STATES = ["none", "upsert", "delete"] as const;
type PendingState = (typeof PENDING_STATES)[number];

/**
 * Whether a stored row is still leave its owner means to take. A row removed here that the calendar holds
 * stays stored as `pending = 'delete'` until a pass lets it go: for its owner it is already gone,
 * so the calendar, the panel and every balance leave it out. Only the table still lists it, with
 * the badge that says the calendar has not been told yet.
 */
export function stillBooked(row: { pending: PendingState }): boolean {
  return row.pending !== "delete";
}

/** The only two sizes a day off of a type counted in days comes in. */
export const DAY_FRACTIONS = [0.5, 1] as const;

/** A day is `taken` once a payslip has counted it, `planned` until then (N2). */
export type DayStatus = "taken" | "planned";

/* Conversions (plan F7 §3.4.4) */

/** Minutes as a number of days, rounded to a half day — the only granularity a day row has. */
export function minutesToDays(minutes: number, minutesPerDay: number): number {
  if (minutesPerDay <= 0) throw new RangeError("minutesPerDay must be positive");
  return Math.round((minutes / minutesPerDay) * 2) / 2;
}

/** Days as minutes, rounded to the minute: what a half day is worth on this user's schedule. */
export function daysToMinutes(days: number, minutesPerDay: number): number {
  if (minutesPerDay <= 0) throw new RangeError("minutesPerDay must be positive");
  return Math.round(days * minutesPerDay);
}

/* The working week (R5g, E6) */

/** Monday to Friday: the week of a person who set none. */
export const DEFAULT_WORK_DAYS: readonly number[] = [1, 2, 3, 4, 5];

/** Whether a date is a day of the week the person does not work. */
export function isRestDay(date: CivilDate, workDays: readonly number[]): boolean {
  return !workDays.includes(dayOfWeek(date));
}

/* Bookability (spec §7.9) */

type Bookable = { ok: true } | { ok: false; reason: "weekend" | "holiday" };

/**
 * Whether a leave day may be booked on a date: a day of the person's working week, and not one of
 * their holidays or days off of the year. The refusal carries its reason because the form shows it
 * on the date field, not as a generic error.
 */
export function bookable(
  date: CivilDate,
  holidays: ReadonlySet<CivilDate>,
  workDays: readonly number[] = DEFAULT_WORK_DAYS,
): Bookable {
  if (isRestDay(date, workDays)) return { ok: false, reason: "weekend" };
  if (holidays.has(date)) return { ok: false, reason: "holiday" };
  return { ok: true };
}

/**
 * Whether a day counts as taken (N2; R5g decision 3 = A).
 *
 * In a year with applied payslips, the payslip decides: a day is **taken** once a payslip covers
 * the month it was used in, and **planned** until then — the leave of last week is not leave the
 * employer has counted yet. `countedThrough` is that month ("YYYY-MM-01").
 *
 * In a year with none (`countedThrough` null), no employer counts anything here: a day before
 * `today` is taken, today and after are planned. With no `today` either, nothing is taken.
 */
export function dayStatus(
  date: CivilDate,
  countedThrough: MonthKey | null,
  today: CivilDate | null = null,
): DayStatus {
  if (countedThrough === null) return today !== null && date < today ? "taken" : "planned";
  return date.slice(0, 7) <= countedThrough.slice(0, 7) ? "taken" : "planned";
}

/* The shape of a day, as the pure rules see it */

export interface LeaveDayView {
  on: CivilDate;
  /** The id of the day's type. */
  typeId: string;
  /** Half a day or a whole one; for a type counted in hours, the nearest of the two. */
  fraction: number;
  /** The length of a row of a type counted in hours; absent or null for the others. */
  minutes?: number | null;
}

/** What one day is worth in minutes, on this person's working day. */
export function minuteWeight(day: LeaveDayView, minutesPerDay: number): number {
  return day.minutes ?? daysToMinutes(day.fraction, minutesPerDay);
}

/** The fraction a row of `minutes` keeps beside its minutes: the nearest of the two sizes. */
export function fractionOfMinutes(minutes: number, minutesPerDay: number): number {
  return minutes * 4 > minutesPerDay * 3 ? 1 : 0.5;
}

/** The order of the person's types, for anything listed by type. */
export function byTypeOrder(types: readonly Pick<LeaveType, "id">[]) {
  const order = new Map(types.map((type, index) => [type.id, index]));
  return (a: string, b: string): number => (order.get(a) ?? types.length) - (order.get(b) ?? types.length);
}
