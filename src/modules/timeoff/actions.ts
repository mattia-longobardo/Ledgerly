// src/modules/timeoff/actions.ts — the Time off Server Actions (spec §4.2, §7.9): validate →
// service → revalidate, and then a Trek pass in the background — waiting an hour to see a day you
// just booked appear in the company calendar is not what anybody means by "saved" (§3.4.10).
"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { redactForLog } from "@/platform/auth/logger";
import { requireSession } from "@/platform/auth/session";
import type { Ctx } from "@/platform/context";
import { TimeOffError, deleteLeaveDay, saveAllowance, saveLeaveDay } from "./service";

export type ActionResult = { ok: true } | { ok: false; error: string; refused?: RefusedDate[] };
export interface RefusedDate {
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
  revalidatePath("/timeoff");
}

/**
 * Starts a Trek pass once the response has gone out (`after()`), so the screen never waits on a
 * provider. A user with no Trek link does nothing at all; a pass already running is not an error
 * to show anybody, and a pass that fails has already written its own `sync_runs` row — §3.4.11
 * says an hourly condition is not worth interrupting somebody over.
 */
function nudgeTrek(ctx: Ctx): void {
  after(async () => {
    try {
      const { syncTrekNow } = await import("@/platform/integrations/trek/sync");
      await syncTrekNow(ctx);
    } catch (error) {
      console.error("[timeoff] the Trek pass after a save did not finish", redactForLog(error));
    }
  });
}

/** The allowance modal: days as typed, an empty field being nothing stated. */
export interface AllowanceFormInput {
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

/** The "Add leave" modal: one day or a range, and one unit or the other. */
export interface LeaveFormInput {
  from: string;
  to: string;
  kind: string;
  /** "1" or "0.5" — every kind, ROL included since N0. */
  fraction: string;
  note: string;
}

const KINDS = z.enum(["vacation", "rol", "comp", "sick", "other"]);

export async function saveLeaveAction(input: LeaveFormInput): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    const kind = KINDS.parse(input.kind);
    await saveLeaveDay(ctx, {
      from: input.from,
      to: input.to.trim() || null,
      kind,
      fraction: optionalNumber(input.fraction) ?? 1,
      note: input.note.trim() || null,
    });
    revalidate();
    // Only the two kinds Trek knows are worth a pass; ROL, sickness and "other" never leave here.
    if (kind === "vacation" || kind === "comp") nudgeTrek(ctx);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function deleteLeaveAction(id: string): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    const outcome = await deleteLeaveDay(ctx, z.uuid().parse(id));
    revalidate();
    // Only a removal Trek has to be told about is worth a pass; a day it never had is just gone.
    if (outcome === "pending") nudgeTrek(ctx);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}
