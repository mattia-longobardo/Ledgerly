// The calls of Time off › Settings to `/api/v1` (rewrite plan R3): the types of leave and their
// allowances, the working week, the days off of the year, the working day and the holiday calendars. Each keeps the name and the answer of the Server Action it replaces; a write
// reads again what it made stale, with the year of the Time off page.
import { profile } from "@ledgerly/api-contract/settings";
import { holidays, timeoff, types } from "@ledgerly/api-contract/timeoff";
import { ApiError, call } from "@ledgerly/api-client";
import type { HolidayCountry, HolidaySubdivision } from "@ledgerly/domain/platform/holidays/client";
import { invalidate } from "@ledgerly/ui/data";
import { z } from "zod";
import { refusal } from "@/platform/writes";

type ActionResult = { ok: true } | { ok: false; error: string };
type HolidayActionError = "unreachable" | "duplicate" | "tooMany" | "notFound" | "invalid" | "failed";
export type HolidayActionResult = { ok: true } | { ok: false; error: HolidayActionError };

/** What a write of Settings made stale: the types, the week, the days off, the calendars and the year. */
export function settingsChanged(): void {
  invalidate(
    types.listLeaveTypes,
    types.getLeaveSettings,
    types.listRestDays,
    holidays.listHolidayCalendars,
    profile.getPreferences,
    timeoff.getTimeOff,
  );
}

/** A number of days typed in a form the client cannot read: what the Server Action answered. */
class Unreadable extends Error {}

async function write(work: () => Promise<unknown>): Promise<ActionResult> {
  try {
    await work();
    return { ok: true };
  } catch (error) {
    return error instanceof Unreadable ? { ok: false, error: "invalid_input" } : refusal(error);
  }
}

/* The types of leave, their allowances, the working week and the days off (R5g) */

/** A type of leave as its dialog sends it. */
export type LeaveTypeFields = z.input<typeof types.createLeaveType.body>;

/** Adds a type (no `id`) or changes one. A name already in use is `conflict`. */
export function saveLeaveTypeAction(id: string | null, fields: LeaveTypeFields): Promise<ActionResult> {
  return write(() =>
    id === null
      ? call(types.createLeaveType, { body: fields })
      : call(types.updateLeaveType, { params: { id }, body: fields }),
  );
}

/** Removes a type; one with days booked is refused with `in_use`. */
export function deleteLeaveTypeAction(id: string): Promise<ActionResult> {
  return write(() => call(types.deleteLeaveType, { params: { id } }));
}

/** A decimal as the allowance form accepts it, with either separator; empty is `null`. */
function optionalNumber(value: string): number | null {
  const text = value.trim().replace(",", ".");
  if (text === "") return null;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) throw new Unreadable();
  return parsed;
}

/** What a year grants of one type, in days as typed; an empty field states nothing. */
export function saveTypeAllowanceAction(input: {
  typeId: string;
  year: number;
  days: string;
  carriedDays: string;
}): Promise<ActionResult> {
  return write(() =>
    call(types.saveTypeAllowance, {
      params: { id: input.typeId, year: String(input.year) },
      body: { days: optionalNumber(input.days), carriedDays: optionalNumber(input.carriedDays) },
    }),
  );
}

/** The working week (0 Sunday … 6 Saturday) and the first month of the leave year. */
export function saveLeaveSettingsAction(input: {
  workDays: number[];
  yearStartMonth: number;
}): Promise<ActionResult> {
  return write(() => call(types.saveLeaveSettings, { body: input }));
}

/** A day of the year the person does not work, every year: a date already there is `conflict`. */
export function addRestDayAction(input: { month: number; day: number; name: string }): Promise<ActionResult> {
  return write(() => call(types.addRestDay, { body: { ...input, name: input.name.trim() } }));
}

export function deleteRestDayAction(id: string): Promise<ActionResult> {
  return write(() => call(types.deleteRestDay, { params: { id } }));
}

/** The working day (`PATCH /preferences`). */
export function saveTimeOffPreferencesAction(input: { minutesPerDay: number }): Promise<ActionResult> {
  return write(() => call(profile.updatePreferences, { body: input }));
}

/* The holiday calendars (Time off › Settings, M3) */

const HOLIDAY_REASONS: Record<string, HolidayActionError> = { duplicate: "duplicate", too_many: "tooMany" };

/** A refusal in the words of the calendars' card; anything else is «failed». */
function holidayFailure(error: unknown): { ok: false; error: HolidayActionError } {
  if (error instanceof z.ZodError) return { ok: false, error: "invalid" };
  if (!(error instanceof ApiError)) return { ok: false, error: "failed" };
  // The source of a calendar did not answer (503): the calendar's card says so in its own words.
  if (error.code === "unavailable") return { ok: false, error: "unreachable" };
  if (error.status >= 500) return { ok: false, error: "failed" };
  if (error.code === "not_found") return { ok: false, error: "notFound" };
  if (error.code === "conflict")
    return { ok: false, error: HOLIDAY_REASONS[error.reason ?? ""] ?? "invalid" };
  if (error.code === "invalid") return { ok: false, error: "invalid" };
  return { ok: false, error: "failed" };
}

/** Every country either service can answer for, in the user's own language. */
export async function holidayCountriesAction(): Promise<
  { ok: true; countries: HolidayCountry[] } | { ok: false; error: HolidayActionError }
> {
  try {
    return { ok: true, ...(await call(holidays.listHolidayCountries, {})) };
  } catch (error) {
    return holidayFailure(error);
  }
}

/** The places inside a country, when the source can name them. */
export async function holidaySubdivisionsAction(
  source: string,
  country: string,
): Promise<{ ok: true; places: HolidaySubdivision[] } | { ok: false; error: HolidayActionError }> {
  try {
    const query = holidays.listHolidaySubdivisions.query.parse({ source, country });
    return { ok: true, ...(await call(holidays.listHolidaySubdivisions, { query })) };
  } catch (error) {
    return holidayFailure(error);
  }
}

async function calendarWrite(work: () => Promise<unknown>): Promise<HolidayActionResult> {
  try {
    await work();
    return { ok: true };
  } catch (error) {
    return holidayFailure(error);
  }
}

/**
 * Keeps a calendar and fetches it straight away. A fetch that fails still keeps it: the daily pass
 * will try again, and the card says what went wrong meanwhile.
 */
export function addHolidayCalendarAction(input: {
  source: string;
  country: string;
  subdivision: string | null;
  label: string;
}): Promise<HolidayActionResult> {
  return calendarWrite(() =>
    call(holidays.addHolidayCalendar, {
      body: holidays.addHolidayCalendar.body.parse(input),
    }),
  );
}

export function removeHolidayCalendarAction(id: string): Promise<HolidayActionResult> {
  return calendarWrite(() => call(holidays.removeHolidayCalendar, { params: { id } }));
}

/** "Update now" for one calendar: the same two years the daily job keeps. */
export function refreshHolidayCalendarAction(id: string): Promise<HolidayActionResult> {
  return calendarWrite(() => call(holidays.refreshHolidayCalendar, { params: { id } }));
}
