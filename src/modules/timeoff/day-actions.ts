// src/modules/timeoff/day-actions.ts — the two verbs the calendar itself has (N3).
//
// Separate from `actions.ts` because they are the calendar's, not the form's: no dialog, no
// validation of typed text, just "this day" and what should become of it. Clicking a day is meant
// to feel like ticking a box, and a round trip through a modal is not that.
//
// The server decides what a click means, from what is actually stored — not the browser from what
// it last drew. Two clicks racing each other then settle into one order instead of disagreeing.
"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { redactForLog } from "@/platform/auth/logger";
import { requireSession } from "@/platform/auth/session";
import type { Ctx } from "@/platform/context";
import { isCivilDate } from "@/platform/dates";
import { TimeOffError, clearDay, cycleDay, halveDay, splitDay } from "./service";

export type DayActionResult =
  | { ok: true; removed?: number; pending?: number }
  | { ok: false; error: string; refused?: { on: string; reason: "weekend" | "holiday" }[] };

function failed(error: unknown): {
  ok: false;
  error: string;
  refused?: { on: string; reason: "weekend" | "holiday" }[];
} {
  if (error instanceof TimeOffError) {
    return error.refused.length > 0
      ? { ok: false, error: error.code, refused: [...error.refused] }
      : { ok: false, error: error.code };
  }
  if (error instanceof z.ZodError || error instanceof RangeError) return { ok: false, error: "invalid" };
  throw error;
}

const dateSchema = z.string().refine(isCivilDate, "not a civil date");

function revalidate(): void {
  revalidatePath("/timeoff");
}

/** A Trek pass after the response has gone out; a link that is not there does nothing at all. */
function nudgeTrek(ctx: Ctx): void {
  after(async () => {
    try {
      const { syncTrekNow } = await import("@/platform/integrations/trek/sync");
      await syncTrekNow(ctx);
    } catch (error) {
      console.error("[timeoff] the Trek pass after a click did not finish", redactForLog(error));
    }
  });
}

/**
 * One click on a day: nothing becomes a whole day of vacation, vacation becomes ROL, ROL becomes
 * vacation again. The two kinds a person books over and over, on the one control they are looking
 * at; everything else — half days, notes, sickness — is a kind of detail, and lives in the dialog.
 */
export async function cycleDayAction(date: string): Promise<DayActionResult> {
  const ctx = await requireSession();
  try {
    await cycleDay(ctx, dateSchema.parse(date));
    revalidate();
    nudgeTrek(ctx);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

/** The right button: whatever is on that day goes. */
export async function clearDayAction(date: string): Promise<DayActionResult> {
  const ctx = await requireSession();
  try {
    const removed = await clearDay(ctx, dateSchema.parse(date));
    revalidate();
    // Only a removal Trek has to be told about is worth a pass; a day it never had is just gone.
    if (removed.pending > 0) nudgeTrek(ctx);
    return { ok: true, removed: removed.deleted + removed.pending, pending: removed.pending };
  } catch (error) {
    return failed(error);
  }
}

/**
 * The right button held down: half a day of vacation and half of ROL, and held again a whole day
 * of vacation back (N10). The one shape a click cannot reach, since every other shortcut here
 * deals in one kind at a time.
 */
export async function splitDayAction(date: string): Promise<DayActionResult> {
  const ctx = await requireSession();
  try {
    await splitDay(ctx, dateSchema.parse(date));
    revalidate();
    nudgeTrek(ctx);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

/**
 * Held down: a day of vacation or ROL becomes half a day, and half a day becomes a whole one (N3).
 * The one measure people change often enough to deserve a gesture rather than a dialog.
 */
export async function halveDayAction(date: string): Promise<DayActionResult> {
  const ctx = await requireSession();
  try {
    await halveDay(ctx, dateSchema.parse(date));
    revalidate();
    nudgeTrek(ctx);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}
