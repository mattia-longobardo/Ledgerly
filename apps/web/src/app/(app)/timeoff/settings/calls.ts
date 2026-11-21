// The calls of Time off › Settings to `/api/v1` (rewrite plan R3): the allowance, the working day and
// the holiday calendars. Each keeps the name and the answer of the Server Action it replaces; a write
// reads again what it made stale, with the year of the Time off page.
import { profile } from "@ledgerly/api-contract/settings";
import { holidays, timeoff } from "@ledgerly/api-contract/timeoff";
import { ApiError, call } from "@ledgerly/api-client";
import type { HolidayCountry, HolidaySubdivision } from "@ledgerly/domain/platform/holidays/client";
import { invalidate } from "@ledgerly/ui/data";
import { z } from "zod";
import { refusal } from "@/platform/writes";

type ActionResult = { ok: true } | { ok: false; error: string };
type HolidayActionError = "unreachable" | "duplicate" | "tooMany" | "notFound" | "invalid" | "failed";
export type HolidayActionResult = { ok: true } | { ok: false; error: HolidayActionError };

/** What a write of Settings made stale: the allowances, the calendars, the working day and the year. */
export function settingsChanged(): void {
  invalidate(
    timeoff.listTimeOffAllowances,
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

/* The allowance and the working day (Time off › Settings) */

/** The allowance modal: days as typed, an empty field being nothing stated. */
interface AllowanceFormInput {
  year: string;
  vacationDays: string;
  rolDays: string;
  /** Vacation and ROL together, in days, as the contract states it (N7). */
  totalDays: string;
  note: string;
}

/** A decimal as the allowance form accepts it, with either separator; empty is `null`. */
function optionalNumber(value: string): number | null {
  const text = value.trim().replace(",", ".");
  if (text === "") return null;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) throw new Unreadable();
  return parsed;
}

export function saveAllowanceAction(input: AllowanceFormInput): Promise<ActionResult> {
  return write(() =>
    call(timeoff.saveTimeOffAllowance, {
      params: { year: input.year },
      body: {
        vacationDays: optionalNumber(input.vacationDays),
        rolDays: optionalNumber(input.rolDays),
        totalDays: optionalNumber(input.totalDays),
        note: input.note.trim() || null,
      },
    }),
  );
}

/** The working day or the patron saint, each form on its own (`PATCH /preferences`). */
export function saveTimeOffPreferencesAction(input: {
  minutesPerDay?: number;
  patronSaint?: { month: number; day: number } | null;
}): Promise<ActionResult> {
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
