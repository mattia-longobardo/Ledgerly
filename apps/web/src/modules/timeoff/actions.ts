// src/modules/timeoff/actions.ts — the Time off Server Actions (spec §4.2, §7.9): validate →
// service → revalidate, and then a Trek pass in the background — waiting an hour to see a day you
// just booked appear in the company calendar is not what anybody means by "saved" (§3.4.10).
"use server";

import { revalidatePath } from "next/cache";
import { enqueue } from "@ledgerly/domain/platform/jobs";
import { tasks } from "@/platform/jobs/queue";
import { trekConnection } from "@ledgerly/domain/platform/integrations/trek";
import { z } from "zod";
import { requireSession } from "@/platform/auth/session";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { LEAVE_DAY_KINDS, type LeaveUndo } from "@ledgerly/domain/timeoff";
import {
  TimeOffError,
  removeLeave,
  removeLeaveRange,
  restoreLeave,
  saveAllowance,
  saveLeaveRange,
} from "@ledgerly/domain/timeoff";
import { civilDate } from "@ledgerly/api-contract";

type ActionResult = { ok: true } | { ok: false; error: string; refused?: RefusedDate[] };
interface RefusedDate {
  on: string;
  reason: "weekend" | "holiday";
}

function failed(error: unknown): { ok: false; error: string; refused?: RefusedDate[] } {
  if (error instanceof TimeOffError) {
    return error.refused.length > 0
      ? { ok: false, error: error.code, refused: [...error.refused] }
      : { ok: false, error: error.code };
  }
  if (error instanceof z.ZodError || error instanceof RangeError) return { ok: false, error: "invalid" };
  throw error;
}

function revalidate(): void {
  revalidatePath("/timeoff", "layout");
}

/**
 * Asks the worker for a Trek pass, so the screen never waits on a provider. A user with no Trek
 * link does nothing at all; a pass already running is not an error to show anybody, and a pass that
 * fails has already written its own `sync_runs` row — §3.4.11 says an hourly condition is not worth
 * interrupting somebody over.
 */
async function nudgeTrek(ctx: Ctx): Promise<void> {
  const connection = await trekConnection(ctx);
  if (connection) await enqueue(tasks.updateConnection(ctx.userId, connection.id, null));
}

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
  const ctx = await requireSession();
  try {
    const year = Number(input.year);

    await saveAllowance(ctx, year, {
      vacationDays: optionalNumber(input.vacationDays),
      rolDays: optionalNumber(input.rolDays),
      totalDays: optionalNumber(input.totalDays),
      note: input.note.trim() || null,
    });
    revalidate();
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

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

export type LeaveActionResult =
  | { ok: true; undo: LeaveUndo; days: number; removed: number; pending: number }
  | { ok: false; error: string; refused?: RefusedDate[] };

const KINDS = z.enum(LEAVE_DAY_KINDS);

/**
 * "Confirm" in the leave panel: one call writes the whole range (rewrite plan N5). The answer
 * carries what the touched days held before, which is what the toast's "Undo" sends back.
 */
export async function saveLeaveRangeAction(input: LeaveFormInput): Promise<LeaveActionResult> {
  const ctx = await requireSession();
  try {
    const result = await saveLeaveRange(ctx, {
      from: input.from,
      to: input.to,
      kind: KINDS.parse(input.kind),
      fraction: optionalNumber(input.fraction) ?? 1,
      note: input.note.trim() || null,
      editedKind: input.editedKind == null ? null : KINDS.parse(input.editedKind),
      // "½ + ½" only: every other call reaches the service as it did before.
      ...(input.otherKind == null ? {} : { otherKind: KINDS.parse(input.otherKind) }),
    });
    revalidate();
    // The service knows whether the next pass has work: one list says what reaches Trek.
    if (result.trek) await nudgeTrek(ctx);
    return { ok: true, undo: result.undo, days: result.totalDays, removed: 0, pending: 0 };
  } catch (error) {
    return failed(error);
  }
}

const removalSchema = z.union([
  z.object({ id: z.uuid() }),
  z.object({ date: civilDate("not a civil date") }),
]);

/** "Remove": one row by its id, or everything on one date (Delete on a day of the calendar). */
export async function removeLeaveAction(
  target: { id: string } | { date: string },
): Promise<LeaveActionResult> {
  const ctx = await requireSession();
  try {
    const removed = await removeLeave(ctx, removalSchema.parse(target));
    revalidate();
    // Only a removal Trek has to be told about is worth a pass; a day it never had is just gone.
    if (removed.pending > 0) await nudgeTrek(ctx);
    return {
      ok: true,
      undo: removed.undo,
      days: 0,
      removed: removed.deleted + removed.pending,
      pending: removed.pending,
    };
  } catch (error) {
    return failed(error);
  }
}

/**
 * "Remove N days": everything booked between two dates, in one transaction (N5 §7.5). Trek hears
 * of each row as it hears of one removed day: by the pass this starts.
 */
export async function removeLeaveRangeAction(range: {
  from: string;
  to: string;
}): Promise<LeaveActionResult> {
  const ctx = await requireSession();
  try {
    const removed = await removeLeaveRange(ctx, range);
    if (removed.undo === null) {
      return { ok: true, undo: { dates: [range.from], rows: [] }, days: 0, removed: 0, pending: 0 };
    }
    revalidate();
    if (removed.pending > 0) await nudgeTrek(ctx);
    return {
      ok: true,
      undo: removed.undo,
      days: removed.days,
      removed: removed.deleted + removed.pending,
      pending: removed.pending,
    };
  } catch (error) {
    return failed(error);
  }
}

/** "Undo" in the toast: the touched days go back to what they held, in one transaction. */
export async function undoLeaveAction(undo: LeaveUndo): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    const restored = await restoreLeave(ctx, undo);
    revalidate();
    if (restored.trek) await nudgeTrek(ctx);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}
