import { type CivilDate, type MonthKey } from "../../../shared/dates";
import { isWeekend } from "../../../platform/holidays/rules";

/** What a day off can be. */
export const LEAVE_DAY_KINDS = ["vacation", "rol", "comp", "sick", "other"] as const;
export type LeaveDayKind = (typeof LEAVE_DAY_KINDS)[number];

/** The kinds the calendar's own rows can be in, and therefore the only ones a toggle may ever name. */
export const CALENDAR_KINDS = ["vacation", "comp"] as const;
type CalendarKind = (typeof CALENDAR_KINDS)[number];

/**
 * The kinds that reach the calendar at all — the leave that spends the year's allowance.
 *
 * ROL is among them since N4 even though the calendar has no such thing: it goes across as `vacation`,
 * which is the owner's own instruction and the only honest option, since a day that is not on
 * the calendar reads to a colleague as a day at work. Sickness and "other" stay here: they are absences
 * of a different kind, not leave anybody books.
 */
const KINDS_FOR_CALENDAR = ["vacation", "rol", "comp"] as const;

export function goesToCalendar(kind: LeaveDayKind): boolean {
  return (KINDS_FOR_CALENDAR as readonly string[]).includes(kind);
}

/**
 * What a kind becomes on the calendar: everything that goes there goes as a holiday (N4).
 *
 * The argument is taken and ignored on purpose — the call site reads as a mapping, and the day
 * the answer stops being the same for every kind this is the one place that has to change.
 */
export function asCalendarKind(kind: LeaveDayKind): CalendarKind {
  void kind;
  return "vacation";
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

/** The only two sizes a day off comes in. */
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

/* Bookability (spec §7.9) */

type Bookable = { ok: true } | { ok: false; reason: "weekend" | "holiday" };

/**
 * Whether a leave day may be booked on a date: not a weekend, and not one of this person's public
 * holidays. The refusal carries its reason because the form shows it on the date field, not as a
 * generic error.
 *
 * The holidays arrive as a set of dates rather than a country and a town: which calendars a person
 * keeps is their own business (M3), and by the time a rule is deciding about one date the answer
 * is simply "is it in there".
 */
export function bookable(date: CivilDate, holidays: ReadonlySet<CivilDate>): Bookable {
  if (isWeekend(date)) return { ok: false, reason: "weekend" };
  if (holidays.has(date)) return { ok: false, reason: "holiday" };
  return { ok: true };
}

/**
 * Whether a day counts as taken (N2).
 *
 * Not the calendar's opinion but the payslip's: a day is **taken** once the employer has counted
 * it, which is to say once a payslip has arrived covering the month it was used in. Everything
 * else is **planned** — the future, and the days of a month whose payslip has not come yet.
 *
 * It used to be "past is taken, future is planned", which was simpler and said the wrong thing:
 * the leave you took last week is not yet leave anybody has counted, and the residual the payslip
 * prints does not know about it. With no payslips at all, `countedThrough` is `null` and nothing
 * is taken — which is exactly right for somebody whose employer's numbers this app has never seen.
 *
 * `countedThrough` is a month ("YYYY-MM-01"): the last month of use an applied payslip accounts for.
 */
export function dayStatus(date: CivilDate, countedThrough: MonthKey | null): DayStatus {
  if (countedThrough === null) return "planned";
  return date.slice(0, 7) <= countedThrough.slice(0, 7) ? "taken" : "planned";
}

/* The shape of a day, as the pure rules see it */

export interface LeaveDayView {
  on: CivilDate;
  kind: LeaveDayKind;
  /** Half a day or a whole one — the only two a day off comes in, every kind alike (N0). */
  fraction: number;
}

/** What one day is worth in days. */
export function dayWeight(day: LeaveDayView): number {
  return day.fraction;
}

/** What one day is worth in minutes, on this person's working day. */
export function minuteWeight(day: LeaveDayView, minutesPerDay: number): number {
  return daysToMinutes(day.fraction, minutesPerDay);
}
