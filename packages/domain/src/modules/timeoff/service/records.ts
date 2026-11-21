import { and, asc, eq, gte, lte } from "drizzle-orm";
import { getPreferences } from "../../users/service";
import { holidaysFor } from "../../../platform/holidays/service";
import type { Ctx } from "../../../platform/context";
import type { CivilDate } from "../../../shared/dates";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import {
  type AllowanceInput,
  type LeaveInput,
  MAX_RANGE_DAYS,
  allowanceInputSchema,
  bookable,
  datesBetween,
  goesToTrek,
  leaveInputSchema,
} from "../rules";
import { leaveDays, timeoffAllowances } from "../schema";

export type Allowance = typeof timeoffAllowances.$inferSelect;
export type LeaveDay = typeof leaveDays.$inferSelect;

type TimeOffErrorCode =
  | "not_found"
  | "invalid_input"
  /** The date is a weekend or a public holiday: the reason travels with the error. */
  | "not_bookable"
  /** A range that would write more days than anyone books in one go. */
  | "range_too_long";

export { MAX_RANGE_DAYS };

export class TimeOffError extends Error {
  constructor(
    readonly code: TimeOffErrorCode,
    /** For `not_bookable`: which dates were refused and why. */
    readonly refused: ReadonlyArray<{ on: CivilDate; reason: "weekend" | "holiday" }> = [],
  ) {
    super(code);
    this.name = "TimeOffError";
  }
}

/* Allowances (spec §6, §7.9) */

/** The allowance stated for a year, or `null` when nobody has stated one (plan F7 §3.4.13). */
export async function allowanceOf(ctx: Pick<Ctx, "userId">, year: number): Promise<Allowance | null> {
  const [row] = await getDb()
    .select()
    .from(timeoffAllowances)
    .where(and(userScoped(ctx).owns(timeoffAllowances), eq(timeoffAllowances.year, year)));
  return row ?? null;
}

/** Every allowance this user has stated, oldest year first — the modal proposes the previous one. */
export async function listAllowances(ctx: Pick<Ctx, "userId">): Promise<Allowance[]> {
  return getDb()
    .select()
    .from(timeoffAllowances)
    .where(userScoped(ctx).owns(timeoffAllowances))
    .orderBy(asc(timeoffAllowances.year));
}

/**
 * States a year's allowance, replacing whatever was there. One row per year is the database's
 * rule, so this is an upsert rather than a read followed by a write.
 */
export async function saveAllowance(
  ctx: Pick<Ctx, "userId">,
  year: number,
  input: AllowanceInput,
): Promise<Allowance> {
  const parsed = allowanceInputSchema.safeParse(input);
  if (!parsed.success) throw new TimeOffError("invalid_input");
  if (!Number.isInteger(year) || year < 1990 || year > 2200) throw new TimeOffError("invalid_input");

  const values = {
    vacationDays: parsed.data.vacationDays === null ? null : parsed.data.vacationDays.toFixed(2),
    rolDays: parsed.data.rolDays === null ? null : parsed.data.rolDays.toFixed(2),
    totalDays: parsed.data.totalDays === null ? null : parsed.data.totalDays.toFixed(2),
    note: parsed.data.note ?? null,
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

/* Leave days (spec §7.9) */

export interface LeaveWindow {
  from: CivilDate;
  to: CivilDate;
}

/** Every day in a window, in a deterministic order: by date, then by kind. */
export async function listLeaveDays(ctx: Pick<Ctx, "userId">, window: LeaveWindow): Promise<LeaveDay[]> {
  return getDb()
    .select()
    .from(leaveDays)
    .where(and(userScoped(ctx).owns(leaveDays), gte(leaveDays.on, window.from), lte(leaveDays.on, window.to)))
    .orderBy(asc(leaveDays.on), asc(leaveDays.kind), asc(leaveDays.id));
}

/** The whole of a calendar year, which is what the screen shows. */
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
 * database's rule — and either way the row goes back to `pending = 'upsert'` when Trek knows this
 * kind, because Trek has not been told yet. The `synced_at` of the previous state is kept: it is
 * the record of what Trek holds, and a pass that has not run yet has not changed it.
 */
export async function saveLeaveDay(ctx: Pick<Ctx, "userId">, input: LeaveInput): Promise<LeaveDay[]> {
  const parsed = leaveInputSchema.safeParse(input);
  if (!parsed.success) throw new TimeOffError("invalid_input");
  const { from, kind, note } = parsed.data;
  const to = parsed.data.to ?? from;
  const fraction = parsed.data.fraction ?? null;

  const { patronSaint } = await getPreferences(ctx);
  const span = datesBetween(from, to);
  if (span.length > MAX_RANGE_DAYS) throw new TimeOffError("range_too_long");
  // A range can cross new year, so both years are asked for.
  const years = [...new Set(span.map((date) => Number(date.slice(0, 4))))];
  const holidays = await holidaysFor(ctx, years, patronSaint);

  const refused: { on: CivilDate; reason: "weekend" | "holiday" }[] = [];
  const keep: CivilDate[] = [];
  for (const date of span) {
    const verdict = bookable(date, holidays);
    if (verdict.ok) keep.push(date);
    else refused.push({ on: date, reason: verdict.reason });
  }
  // A single day the user named: their mistake is worth saying out loud. A range: the weekend in
  // the middle is not a mistake, it is how ranges work — unless the whole range is unbookable.
  if (span.length === 1 || keep.length === 0) {
    if (refused.length > 0) throw new TimeOffError("not_bookable", refused);
  }

  const pending = goesToTrek(kind) ? ("upsert" as const) : ("none" as const);
  const values = {
    kind,
    // Every kind is half a day or a whole one since N0; ROL no longer states minutes.
    fraction: (fraction ?? 1).toFixed(1),
    note: note ?? null,
    pending,
  };

  return getDb()
    .insert(leaveDays)
    .values(keep.map((on) => userScoped(ctx).stamp({ on, ...values })))
    .onConflictDoUpdate({
      target: [leaveDays.userId, leaveDays.on, leaveDays.kind],
      set: {
        fraction: values.fraction,
        note: values.note,
        pending: values.pending,
        updatedAt: new Date(),
      },
    })
    .returning();
}

/**
 * Removes a day (spec §7.9), which is two different things depending on what Trek knows:
 *
 *  - a day Trek has never heard of is simply deleted;
 *  - a day Trek holds is marked `pending = 'delete'` and stays, because Trek has to be told before
 *    it can go. It disappears from the table the moment the pass confirms the removal.
 *
 * The row is kept whole rather than reduced to a tombstone: the observed `trek_fraction` and
 * `trek_kind` are exactly what the toggle has to send back, and a tombstone would have to carry
 * them anyway (plan F7 §3.4.8).
 */
export async function deleteLeaveDay(ctx: Pick<Ctx, "userId">, id: string): Promise<"deleted" | "pending"> {
  const [row] = await getDb()
    .select()
    .from(leaveDays)
    .where(and(eq(leaveDays.id, id), userScoped(ctx).owns(leaveDays)));
  if (!row) throw new TimeOffError("not_found");

  const knownToTrek = row.origin === "trek" || row.syncedAt !== null;
  if (!knownToTrek) {
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
