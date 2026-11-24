// The calls of the leave panel to `/api/v1` (rewrite plan R3): each keeps the name and the answer of
// the Server Action it replaces. A refusal keeps its words: the reason of the route (`not_bookable`,
// `range_too_long`…) or its code, with the dates a booking refused. Time off › Settings has its own.
import { profile } from "@ledgerly/api-contract/settings";
import { holidays, timeoff } from "@ledgerly/api-contract/timeoff";
import { ApiError, call, type RouteOutput } from "@ledgerly/api-client";
import { invalidate } from "@ledgerly/ui/data";
import { z } from "zod";
import { refusal } from "@/platform/writes";

/** A date a booking could not have, and why: `weekend` or `holiday`. */
type RefusedDate = ApiError["refused"][number];
type Failure = { ok: false; error: string; refused?: readonly RefusedDate[] };
type ActionResult = { ok: true } | Failure;

type LeaveUndo = RouteOutput<typeof timeoff.saveLeave>["undo"];

/** A size typed in the panel the client cannot read: what the Server Action answered. */
class Unreadable extends Error {}

/**
 * What a write made stale, read again: the year, the calendars and the working day.
 * It replaces `router.refresh()` where the screens called it.
 */
export function timeOffChanged(): void {
  invalidate(timeoff.getTimeOff, holidays.listHolidayCalendars, profile.getPreferences);
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

/* The leave panel */

/** The leave panel's fields, as typed: both ends, one type, one size for every day. */
export interface LeaveFormInput {
  from: string;
  to: string;
  typeId: string;
  /** "1" or "0.5"; for a type counted in hours the server works the size out of `minutes`. */
  fraction: string;
  /** For a type counted in hours: the length of every day, in minutes. */
  minutes?: number | null;
  note: string;
  /** Set when the panel edits a row: the type that row has now. */
  editedTypeId?: string | null;
  /** Set for "½ + ½": the type of the second half of every day (decision of 17/11/2026). */
  otherTypeId?: string | null;
}

type LeaveAnswer = RouteOutput<typeof timeoff.saveLeave>;
export type LeaveActionResult = ({ ok: true } & LeaveAnswer) | Failure;

/** The size of every day, "1" or "0.5" as the panel sends it; empty is a whole day. */
function sizeOf(fraction: string): number {
  const text = fraction.trim();
  const size = text === "" ? 1 : Number(text.replace(",", "."));
  if (!Number.isFinite(size)) throw new Unreadable();
  return size;
}

/** "Confirm" in the leave panel: one call writes the whole range (rewrite plan N5). */
export function saveLeaveRangeAction(input: LeaveFormInput): Promise<LeaveActionResult> {
  return write(() =>
    call(timeoff.saveLeave, {
      // A type or a size nobody defined is refused by the route's schema, as the action refused it.
      body: timeoff.saveLeave.body.parse({
        from: input.from,
        to: input.to,
        typeId: input.typeId,
        fraction: sizeOf(input.fraction),
        minutes: input.minutes ?? null,
        note: input.note.trim() || null,
        editedTypeId: input.editedTypeId ?? null,
        otherTypeId: input.otherTypeId ?? null,
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
