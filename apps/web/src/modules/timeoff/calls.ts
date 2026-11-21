// The calls of Time off to `/api/v1` (rewrite plan R3): each keeps the name and the answer of the
// Server Action it replaces, so the panel, the forms of Time off › Settings and the holiday calendars
// read one shape. A refusal keeps its words: the reason of the route (`not_bookable`,
// `range_too_long`…) or its code, with the dates a booking refused.
import { profile } from "@ledgerly/api-contract/settings";
import { holidays, timeoff } from "@ledgerly/api-contract/timeoff";
import { ApiError, call, type RouteOutput } from "@ledgerly/api-client";
import type { HolidayCountry, HolidaySubdivision } from "@ledgerly/domain/platform/holidays/client";
import { invalidate } from "@ledgerly/ui/data";
import { z } from "zod";
import { refusal } from "@/platform/writes";

/** A date a booking could not have, and why: `weekend` or `holiday`. */
type RefusedDate = ApiError["refused"][number];
type Failure = { ok: false; error: string; refused?: readonly RefusedDate[] };
type ActionResult = { ok: true } | Failure;

type HolidayActionError = "unreachable" | "duplicate" | "tooMany" | "notFound" | "invalid" | "failed";
export type HolidayActionResult = { ok: true } | { ok: false; error: HolidayActionError };

type LeaveUndo = RouteOutput<typeof timeoff.saveLeave>["undo"];

/** A number typed in a form the client cannot read: what the Server Action answered. */
class Unreadable extends Error {}

/**
 * What a write made stale, read again: the year, the allowances, the calendars and the working day.
 * It replaces `router.refresh()` where the screens called it.
 */
export function timeOffChanged(): void {
  invalidate(
    timeoff.getTimeOff,
    timeoff.listTimeOffAllowances,
    holidays.listHolidayCalendars,
    profile.getPreferences,
  );
}

function failed(error: unknown): Failure {
  if (error instanceof Unreadable) return { ok: false, error: "invalid_input" };
  // What the route's own schema refuses, read here before the call: `invalid`, as the route answers.
  if (error instanceof z.ZodError) return { ok: false, error: "invalid" };
  const refused = error instanceof ApiError ? error.refused : [];
  const answer = refusal(error);
  return refused.length > 0 ? { ...answer, refused } : answer;
}

async function write<T extends object>(work: () => Promise<T>): Promise<({ ok: true } & T) | Failure> {
  try {
    return { ok: true, ...(await work()) };
  } catch (error) {
    return failed(error);
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
  return write(async () => {
    await call(timeoff.saveTimeOffAllowance, {
      params: { year: input.year },
      body: {
        vacationDays: optionalNumber(input.vacationDays),
        rolDays: optionalNumber(input.rolDays),
        totalDays: optionalNumber(input.totalDays),
        note: input.note.trim() || null,
      },
    });
    return {};
  });
}

/** The working day or the patron saint, each form on its own (`PATCH /preferences`). */
export function saveTimeOffPreferencesAction(input: {
  minutesPerDay?: number;
  patronSaint?: { month: number; day: number } | null;
}): Promise<ActionResult> {
  return write(async () => {
    await call(profile.updatePreferences, { body: input });
    return {};
  });
}

/* The leave panel */

/** The leave panel's fields, as typed: both ends, one kind, one size for every day. */
export interface LeaveFormInput {
  from: string;
  to: string;
  kind: string;
  /** "1" or "0.5" — every kind, ROL included since N0. */
  fraction: string;
  note: string;
  /** Set when the panel edits a row: the kind that row has now. */
  editedKind?: string | null;
  /** Set for "½ + ½": the kind of the second half of every day (decision of 17/11/2026). */
  otherKind?: string | null;
}

type LeaveAnswer = RouteOutput<typeof timeoff.saveLeave>;
export type LeaveActionResult = ({ ok: true } & LeaveAnswer) | Failure;

/** "Confirm" in the leave panel: one call writes the whole range (rewrite plan N5). */
export function saveLeaveRangeAction(input: LeaveFormInput): Promise<LeaveActionResult> {
  return write(() =>
    call(timeoff.saveLeave, {
      // A kind or a size nobody defined is refused by the route's schema, as the action refused it.
      body: timeoff.saveLeave.body.parse({
        from: input.from,
        to: input.to,
        kind: input.kind,
        fraction: optionalNumber(input.fraction) ?? 1,
        note: input.note.trim() || null,
        editedKind: input.editedKind ?? null,
        otherKind: input.otherKind ?? null,
      }),
    }),
  );
}

/** "Remove": one row by its id, or everything on one date (Delete on a day of the calendar). */
export function removeLeaveAction(target: { id: string } | { date: string }): Promise<LeaveActionResult> {
  return write(() =>
    "id" in target
      ? call(timeoff.removeLeaveDay, { params: { id: target.id } })
      : call(timeoff.removeLeaveOnDate, { params: { date: target.date } }),
  );
}

/** "Remove N days": everything booked between two dates, in one transaction (N5 §7.5). */
export function removeLeaveRangeAction(range: { from: string; to: string }): Promise<LeaveActionResult> {
  return write(() => call(timeoff.removeLeaveRange, { query: range }));
}

/** "Undo" in the toast: the touched days go back to what they held, in one transaction. */
export function undoLeaveAction(undo: LeaveUndo): Promise<ActionResult> {
  return write(async () => {
    await call(timeoff.undoLeave, { body: undo });
    return {};
  });
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
