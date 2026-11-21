// src/modules/timeoff/actions.ts — the Time off Server Actions, the only file of them until R3
// (audit TOF-5, TOF-6): the leave panel, the allowance, the working day and the holiday calendars of
// Time off › Settings. Validate → use case → revalidate. The external calendar hears of a change by
// `LeaveChanged`, raised by the use cases: a route raises it the same way.
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/platform/auth/session";
import type { Ctx } from "@ledgerly/domain/platform/context";
import {
  HOLIDAY_SOURCES,
  type HolidayCountry,
  HolidayError,
  HolidayServiceError,
  type HolidaySource,
  type HolidaySubdivision,
  keepCalendar,
  listCountries,
  listSubdivisions,
  refetchCalendar,
  removeCalendar,
} from "@ledgerly/domain/platform/holidays";
import {
  LEAVE_DAY_KINDS,
  type LeaveAnswer,
  type LeaveUndo,
  TimeOffError,
  bookLeave,
  saveAllowance,
  unbookLeave,
  unbookLeaveRange,
  undoLeave,
} from "@ledgerly/domain/timeoff";
import { type TimeOffPreferences, updateTimeOffPreferences } from "@ledgerly/domain/users";
import { civilDate } from "@ledgerly/api-contract";

interface RefusedDate {
  on: string;
  reason: "weekend" | "holiday";
}
type Failure = { ok: false; error: string; refused?: RefusedDate[] };
type ActionResult = { ok: true } | Failure;

type HolidayActionError = "unreachable" | "duplicate" | "tooMany" | "notFound" | "invalid" | "failed";
export type HolidayActionResult = { ok: true } | { ok: false; error: HolidayActionError };

const HOLIDAY_CODES: Record<string, HolidayActionError> = {
  duplicate: "duplicate",
  too_many: "tooMany",
  not_found: "notFound",
};

/**
 * The one adapter of refusals: the leave's codes as they are, the holiday calendars' in the words
 * of their card. `unknown` is what an error nobody expected becomes: the calendars' card says
 * «failed», the leave panel lets it through to the error boundary.
 */
function failed(error: unknown): Failure;
function failed(error: unknown, unknown: "failed"): { ok: false; error: HolidayActionError };
function failed(error: unknown, unknown?: "failed"): Failure {
  if (error instanceof TimeOffError) {
    return error.refused.length > 0
      ? { ok: false, error: error.code, refused: [...error.refused] }
      : { ok: false, error: error.code };
  }
  if (error instanceof HolidayServiceError)
    return { ok: false, error: HOLIDAY_CODES[error.code] ?? "invalid" };
  if (error instanceof HolidayError) return { ok: false, error: "unreachable" };
  if (unknown) return { ok: false, error: unknown };
  if (error instanceof z.ZodError || error instanceof RangeError) return { ok: false, error: "invalid" };
  throw error;
}

function revalidate(): void {
  // The leave screen decides what can be booked from the calendars, the allowance and the days.
  revalidatePath("/timeoff", "layout");
}

/** One write: the use case, the screen drawn again, and its answer; or the refusal. */
async function write<T extends object>(
  work: (ctx: Ctx) => Promise<T>,
): Promise<({ ok: true } & T) | Failure> {
  const ctx = await requireSession();
  try {
    const answer = await work(ctx);
    revalidate();
    return { ok: true, ...answer };
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
  if (!Number.isFinite(parsed)) throw new TimeOffError("invalid_input");
  return parsed;
}

export async function saveAllowanceAction(input: AllowanceFormInput): Promise<ActionResult> {
  return write(async (ctx) => {
    await saveAllowance(ctx, Number(input.year), {
      vacationDays: optionalNumber(input.vacationDays),
      rolDays: optionalNumber(input.rolDays),
      totalDays: optionalNumber(input.totalDays),
      note: input.note.trim() || null,
    });
    return {};
  });
}

/** The working day and the patron saint, each form on its own (route `PATCH /preferences`). */
export async function saveTimeOffPreferencesAction(input: TimeOffPreferences): Promise<ActionResult> {
  return write(async (ctx) => {
    await updateTimeOffPreferences(ctx, input);
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

export type LeaveActionResult = ({ ok: true } & LeaveAnswer) | Failure;

const KINDS = z.enum(LEAVE_DAY_KINDS);

/** "Confirm" in the leave panel: one call writes the whole range (rewrite plan N5). */
export async function saveLeaveRangeAction(input: LeaveFormInput): Promise<LeaveActionResult> {
  return write((ctx) =>
    bookLeave(ctx, {
      from: input.from,
      to: input.to,
      kind: KINDS.parse(input.kind),
      fraction: optionalNumber(input.fraction) ?? 1,
      note: input.note.trim() || null,
      editedKind: input.editedKind == null ? null : KINDS.parse(input.editedKind),
      // "½ + ½" only: every other call reaches the service as it did before.
      ...(input.otherKind == null ? {} : { otherKind: KINDS.parse(input.otherKind) }),
    }),
  );
}

const removalSchema = z.union([
  z.object({ id: z.uuid() }),
  z.object({ date: civilDate("not a civil date") }),
]);

/** "Remove": one row by its id, or everything on one date (Delete on a day of the calendar). */
export async function removeLeaveAction(
  target: { id: string } | { date: string },
): Promise<LeaveActionResult> {
  return write((ctx) => unbookLeave(ctx, removalSchema.parse(target)));
}

/** "Remove N days": everything booked between two dates, in one transaction (N5 §7.5). */
export async function removeLeaveRangeAction(range: {
  from: string;
  to: string;
}): Promise<LeaveActionResult> {
  return write((ctx) => unbookLeaveRange(ctx, range));
}

/** "Undo" in the toast: the touched days go back to what they held, in one transaction. */
export async function undoLeaveAction(undo: LeaveUndo): Promise<ActionResult> {
  return write(async (ctx) => {
    await undoLeave(ctx, undo);
    return {};
  });
}

/* The holiday calendars (Time off › Settings, M3) */

/** Every country either service can answer for, in the user's own language. */
export async function holidayCountriesAction(): Promise<
  { ok: true; countries: HolidayCountry[] } | { ok: false; error: HolidayActionError }
> {
  const ctx = await requireSession();
  try {
    return { ok: true, countries: await listCountries(ctx.locale) };
  } catch (error) {
    return failed(error, "failed");
  }
}

const SOURCES = z.enum(HOLIDAY_SOURCES);
const isSource = (source: string): source is HolidaySource => SOURCES.safeParse(source).success;

/** The places inside a country, when the source can name them. */
export async function holidaySubdivisionsAction(
  source: string,
  country: string,
): Promise<{ ok: true; places: HolidaySubdivision[] } | { ok: false; error: HolidayActionError }> {
  const ctx = await requireSession();
  if (!isSource(source)) return { ok: false, error: "invalid" };
  try {
    return { ok: true, places: await listSubdivisions(source, country, ctx.locale) };
  } catch (error) {
    return failed(error, "failed");
  }
}

/** A write of the holiday calendars: the use case, the screen drawn again, or the card's error. */
async function calendarWrite(work: (ctx: Ctx) => Promise<unknown>): Promise<HolidayActionResult> {
  const ctx = await requireSession();
  try {
    await work(ctx);
  } catch (error) {
    return failed(error, "failed");
  }
  revalidate();
  return { ok: true };
}

/**
 * Subscribes to a calendar and fetches it straight away. A fetch that fails still leaves the
 * subscription: the daily pass will try again, and the card says what went wrong meanwhile.
 */
export async function addHolidayCalendarAction(input: {
  source: string;
  country: string;
  subdivision: string | null;
  label: string;
}): Promise<HolidayActionResult> {
  return calendarWrite(async (ctx) => {
    const source = input.source;
    if (!isSource(source)) throw new HolidayServiceError("invalid_input");
    await keepCalendar(ctx, { ...input, source });
  });
}

export async function removeHolidayCalendarAction(id: string): Promise<HolidayActionResult> {
  return calendarWrite((ctx) => removeCalendar(ctx, id));
}

/** "Update now" for one calendar: the same two years the daily job keeps. */
export async function refreshHolidayCalendarAction(id: string): Promise<HolidayActionResult> {
  return calendarWrite((ctx) => refetchCalendar(ctx, id));
}
