import { and, asc, eq, gte, lte } from "drizzle-orm";
import { getPreferences } from "../../users/service";
import type { Ctx } from "../../../platform/context";
import type { CivilDate } from "../../../shared/dates";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import {
  type LeaveInput,
  MAX_RANGE_DAYS,
  bookable,
  datesBetween,
  fractionOfMinutes,
  leaveInputSchema,
} from "../rules";
import { leaveDays } from "../schema";
import { legacyKind, timeoffAllowances } from "../schema/legacy";
import { TimeOffError } from "./errors";
import { type LeaveTypeView, leaveContext, yearsOf } from "./types";

export type Allowance = typeof timeoffAllowances.$inferSelect;
export type LeaveDay = typeof leaveDays.$inferSelect;

export { MAX_RANGE_DAYS, TimeOffError };

/* The year's old row (R5g: read by the API's deprecated fields only) */

/** The old row of a year, or `null` when nobody has stated one. */
export async function allowanceOf(ctx: Pick<Ctx, "userId">, year: number): Promise<Allowance | null> {
  const [row] = await getDb()
    .select()
    .from(timeoffAllowances)
    .where(and(userScoped(ctx).owns(timeoffAllowances), eq(timeoffAllowances.year, year)));
  return row ?? null;
}

/** Every old row of a year, oldest first. */
export async function listAllowances(ctx: Pick<Ctx, "userId">): Promise<Allowance[]> {
  return getDb()
    .select()
    .from(timeoffAllowances)
    .where(userScoped(ctx).owns(timeoffAllowances))
    .orderBy(asc(timeoffAllowances.year));
}

/** The total and the note of a year's old row, which only the API's deprecated route still states. */
export async function saveYearNote(
  ctx: Pick<Ctx, "userId">,
  year: number,
  input: { totalDays: number | null; note: string | null },
): Promise<Allowance> {
  if (!Number.isInteger(year) || year < 1990 || year > 2200) throw new TimeOffError("invalid_input");
  const total = input.totalDays;
  if (total !== null && !(total >= 0 && total <= 400)) throw new TimeOffError("invalid_input");
  if ((input.note?.trim().length ?? 0) > 200) throw new TimeOffError("invalid_input");
  const values = {
    totalDays: input.totalDays === null ? null : input.totalDays.toFixed(2),
    note: input.note?.trim() || null,
  };
  const [row] = await getDb()
    .insert(timeoffAllowances)
    .values(userScoped(ctx).stamp({ year, ...values }))
    .onConflictDoUpdate({
      target: [timeoffAllowances.userId, timeoffAllowances.year],
      set: { ...values, updatedAt: new Date() },
    })
    .returning();
  return row;
}

/* What a row of a type is written as */

/**
 * The columns of a row of `type`: its size by the type's unit, the old kind it still writes, and
 * what it owes the calendar. A size the unit does not take is `invalid_input`.
 */
export function rowOf(
  type: LeaveTypeView,
  size: { fraction: number; minutes: number | null },
  minutesPerDay: number,
) {
  if (type.unit === "hours") {
    if (size.minutes === null) throw new TimeOffError("invalid_input");
  } else if (size.minutes !== null || (type.unit === "day" && size.fraction !== 1)) {
    throw new TimeOffError("invalid_input");
  }
  const fraction = size.minutes === null ? size.fraction : fractionOfMinutes(size.minutes, minutesPerDay);
  return {
    typeId: type.id,
    kind: legacyKind(type.legacyKind),
    fraction: fraction.toFixed(1),
    minutes: size.minutes,
    pending: type.toCalendar ? ("upsert" as const) : ("none" as const),
  };
}

/** The type of an id among the person's, or `invalid_input`: a day is never written without one. */
export function typeIn(types: readonly LeaveTypeView[], id: string): LeaveTypeView {
  const type = types.find((one) => one.id === id);
  if (!type) throw new TimeOffError("invalid_input");
  return type;
}

/* Leave days (spec §7.9) */

type LeaveWindow = { from: CivilDate; to: CivilDate };

/** Every day in a window, in a deterministic order: by date, then by type, then by id. */
export async function listLeaveDays(ctx: Pick<Ctx, "userId">, window: LeaveWindow): Promise<LeaveDay[]> {
  return getDb()
    .select()
    .from(leaveDays)
    .where(and(userScoped(ctx).owns(leaveDays), gte(leaveDays.on, window.from), lte(leaveDays.on, window.to)))
    .orderBy(asc(leaveDays.on), asc(leaveDays.typeId), asc(leaveDays.id));
}

/** The whole of a calendar year: what the external calendar is read and written by. */
export function yearWindow(year: number): LeaveWindow {
  const padded = String(year).padStart(4, "0");
  return { from: `${padded}-01-01`, to: `${padded}-12-31` };
}

/**
 * Saves a day off, or every working day of a range (spec §7.9).
 *
 * Weekends and holidays are refused, not silently skipped: booking "the 13th to the 17th" over a
 * weekend is almost always what a person meant, so those two days are dropped from a **range**,
 * but a single day that is not bookable is an error the form shows on the date field. The
 * difference is what the user stated, not what the calendar happens to hold.
 *
 * A day that already exists for this kind is updated in place — one row per day and kind is the
 * database's rule — and either way the row goes back to `pending = 'upsert'` when the calendar knows this
 * kind, because the calendar has not been told yet. The `synced_at` of the previous state is kept: it is
 * the record of what the calendar holds, and a pass that has not run yet has not changed it.
 */
export async function saveLeaveDay(ctx: Pick<Ctx, "userId">, input: LeaveInput): Promise<LeaveDay[]> {
  const parsed = leaveInputSchema.safeParse(input);
  if (!parsed.success) throw new TimeOffError("invalid_input");
  const { from, note } = parsed.data;
  const to = parsed.data.to ?? from;

  const span = datesBetween(from, to);
  if (span.length > MAX_RANGE_DAYS) throw new TimeOffError("range_too_long");
  // A range can cross new year, so both years are asked for.
  const { types, settings, holidays } = await leaveContext(ctx, yearsOf({ from, to }));
  const { minutesPerDay } = await getPreferences(ctx);
  const values = {
    ...rowOf(
      typeIn(types, parsed.data.typeId),
      { fraction: parsed.data.fraction ?? 1, minutes: parsed.data.minutes ?? null },
      minutesPerDay,
    ),
    note: note ?? null,
  };

  const refused: { on: CivilDate; reason: "weekend" | "holiday" }[] = [];
  const keep: CivilDate[] = [];
  for (const date of span) {
    const verdict = bookable(date, holidays, settings.workDays);
    if (verdict.ok) keep.push(date);
    else refused.push({ on: date, reason: verdict.reason });
  }
  // A single day the user named: their mistake is worth saying out loud. A range: the weekend in
  // the middle is not a mistake, it is how ranges work — unless the whole range is unbookable.
  if (span.length === 1 || keep.length === 0) {
    if (refused.length > 0) throw new TimeOffError("not_bookable", refused);
  }

  return getDb()
    .insert(leaveDays)
    .values(keep.map((on) => userScoped(ctx).stamp({ on, ...values })))
    .onConflictDoUpdate({
      target: [leaveDays.userId, leaveDays.on, leaveDays.typeId],
      set: {
        fraction: values.fraction,
        minutes: values.minutes,
        note: values.note,
        pending: values.pending,
        updatedAt: new Date(),
      },
    })
    .returning();
}

/**
 * Removes a day (spec §7.9), which is two different things depending on what the calendar knows:
 *
 *  - a day the calendar has never heard of is simply deleted;
 *  - a day the calendar holds is marked `pending = 'delete'` and stays, because the calendar has to be told before
 *    it can go. It disappears from the table the moment the pass confirms the removal.
 *
 * The row is kept whole rather than reduced to a tombstone: the observed fraction and
 * kind are exactly what the toggle has to send back, and a tombstone would have to carry
 * them anyway (plan F7 §3.4.8).
 */
export async function deleteLeaveDay(ctx: Pick<Ctx, "userId">, id: string): Promise<"deleted" | "pending"> {
  const [row] = await getDb()
    .select()
    .from(leaveDays)
    .where(and(eq(leaveDays.id, id), userScoped(ctx).owns(leaveDays)));
  if (!row) throw new TimeOffError("not_found");

  const knownToCalendar = row.origin !== "manual" || row.syncedAt !== null;
  if (!knownToCalendar) {
    await getDb()
      .delete(leaveDays)
      .where(and(eq(leaveDays.id, id), userScoped(ctx).owns(leaveDays)));
    return "deleted";
  }
  await getDb()
    .update(leaveDays)
    .set({ pending: "delete", updatedAt: new Date() })
    .where(and(eq(leaveDays.id, id), userScoped(ctx).owns(leaveDays)));
  return "pending";
}
