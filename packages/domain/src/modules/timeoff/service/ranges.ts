import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { getPreferences } from "../../users/service";
import type { Ctx } from "../../../platform/context";
import type { CivilDate } from "../../../shared/dates";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import {
  type LeaveDayView,
  type LeaveRangeFields,
  type LeaveUndo,
  MAX_RANGE_DAYS,
  bookable,
  datesBetween,
  leaveRangeInputSchema,
  leaveRemovalRangeSchema,
  leaveUndoSchema,
  previewLeaveRange,
  rangeParts,
  stillBooked,
} from "../rules";
import { leaveDays } from "../schema";
import { type LeaveDay, TimeOffError, deleteLeaveDay, listLeaveDays, rowOf, typeIn } from "./records";
import { leaveContext, yearsOf } from "./types";

/* A whole day, and a whole range (rewrite plan N5) */

/**
 * Everything on one day goes: what Delete on a day of the calendar asks for.
 *
 * Whatever the calendar knows about goes the long way round — marked for removal and taken away once the calendar
 * confirms — and whatever it never had simply goes. The counts come back so the caller knows
 * whether a pass of the calendar is worth starting at all.
 */
export async function clearDay(
  ctx: Pick<Ctx, "userId">,
  date: CivilDate,
): Promise<{ deleted: number; pending: number }> {
  const rows = await getDb()
    .select()
    .from(leaveDays)
    .where(and(userScoped(ctx).owns(leaveDays), eq(leaveDays.on, date)));

  let deleted = 0;
  let pending = 0;
  for (const row of rows) {
    if (await deleteLeaveDay(ctx, row.id).then((outcome) => outcome === "pending")) pending += 1;
    else deleted += 1;
  }
  return { deleted, pending };
}

type Transaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/** A row as the rules see it; a row the image before R5g wrote has no type and counts for none. */
const asView = (row: LeaveDay): LeaveDayView => ({
  on: row.on,
  typeId: row.typeId ?? "",
  fraction: Number(row.fraction),
  minutes: row.minutes,
});

/** The rows a person still means to keep, as "Undo" will be handed them back. */
function stateOf(dates: readonly CivilDate[], rows: readonly LeaveDay[]): LeaveUndo {
  return {
    dates: [...dates],
    rows: rows
      // A row waiting for the calendar to let it go is already removed as far as its owner is concerned.
      .filter((row) => row.pending !== "delete" && dates.includes(row.on))
      .map((row) => ({
        on: row.on,
        typeId: row.typeId ?? "",
        fraction: Number(row.fraction),
        minutes: row.minutes,
        note: row.note,
      })),
  };
}

/** {@link deleteLeaveDay} for a row already read, inside the caller's transaction. */
async function takeAway(
  tx: Transaction,
  ctx: Pick<Ctx, "userId">,
  row: LeaveDay,
): Promise<"deleted" | "pending"> {
  const mine = and(eq(leaveDays.id, row.id), userScoped(ctx).owns(leaveDays));
  if (row.origin === "manual" && row.syncedAt === null) {
    await tx.delete(leaveDays).where(mine);
    return "deleted";
  }
  await tx.update(leaveDays).set({ pending: "delete", updatedAt: new Date() }).where(mine);
  return "pending";
}

async function rowsOn(
  tx: Transaction,
  ctx: Pick<Ctx, "userId">,
  where: ReturnType<typeof and>,
): Promise<LeaveDay[]> {
  return tx
    .select()
    .from(leaveDays)
    .where(and(userScoped(ctx).owns(leaveDays), where))
    .orderBy(asc(leaveDays.on), asc(leaveDays.typeId), asc(leaveDays.id))
    .for("update");
}

interface LeaveRangeResult {
  /** The rows written, one per working day of the range. */
  days: LeaveDay[];
  /** What the range comes to, in days. */
  totalDays: number;
  /** What the touched days held before, for "Undo". */
  undo: LeaveUndo;
  /** Whether the next pass of the calendar has something to do, and so is worth starting now. */
  calendar: boolean;
}

/**
 * Writes a range of leave in one transaction: every row, or none (rewrite plan N5).
 *
 * What it does is what {@link previewLeaveRange} says it will, worked out again here from the rows
 * as they are stored — the panel showed the same answer from the page's data, and the server's is
 * the one that counts. Weekends and holidays inside the range are left out; a range with no day
 * anybody works is refused, with the days and their reasons.
 *
 * A row of another kind that no longer fits the day goes the way a removed day goes: at once when
 * The calendar never heard of it, marked for removal when it did. Nothing is said to the calendar from here.
 */
export async function saveLeaveRange(
  ctx: Pick<Ctx, "userId">,
  input: LeaveRangeFields,
): Promise<LeaveRangeResult> {
  const parsed = leaveRangeInputSchema.safeParse(input);
  if (!parsed.success) throw new TimeOffError("invalid_input");
  const { from, to, typeId, fraction } = parsed.data;
  const minutes = parsed.data.minutes ?? null;
  const otherTypeId = parsed.data.otherTypeId ?? null;
  const note = parsed.data.note ?? null;

  const span = datesBetween(from, to);
  if (span.length > MAX_RANGE_DAYS) throw new TimeOffError("range_too_long");
  // A range can cross new year, so both years are asked for.
  const { types, settings, holidays } = await leaveContext(ctx, yearsOf({ from, to }));
  const { minutesPerDay } = await getPreferences(ctx);
  const parts = rangeParts({ typeId, fraction, minutes, otherTypeId });
  // Each part is written by its type's own rule, which also refuses a size the type does not take.
  const rows = parts.map((part) =>
    rowOf(
      typeIn(types, part.typeId),
      { fraction: part.fraction, minutes: part.minutes ?? null },
      minutesPerDay,
    ),
  );
  if (parsed.data.editedTypeId) typeIn(types, parsed.data.editedTypeId);

  return getDb().transaction(async (tx) => {
    const existing = await rowsOn(tx, ctx, and(gte(leaveDays.on, from), lte(leaveDays.on, to)));
    const preview = previewLeaveRange(
      { from, to, typeId, fraction, minutes, otherTypeId, editedTypeId: parsed.data.editedTypeId ?? null },
      // The panel works from the rows still booked; the server answers from the same ones.
      {
        days: existing.filter(stillBooked).map(asView),
        holidays,
        types,
        workDays: settings.workDays,
        minutesPerDay,
      },
    );
    if (preview.written.length === 0) throw new TimeOffError("not_bookable", preview.excluded);

    let owesCalendar = rows.some((row) => row.pending === "upsert");
    for (const gone of preview.removed) {
      const row = existing.find((one) => one.on === gone.on && one.typeId === gone.typeId);
      if (row !== undefined && (await takeAway(tx, ctx, row)) === "pending") owesCalendar = true;
    }

    const days = await tx
      .insert(leaveDays)
      .values(preview.written.flatMap((on) => rows.map((row) => userScoped(ctx).stamp({ on, ...row, note }))))
      .onConflictDoUpdate({
        target: [leaveDays.userId, leaveDays.on, leaveDays.typeId],
        // Each row keeps its own values: `excluded` is the row that was about to be inserted.
        set: {
          fraction: sql`excluded.fraction`,
          minutes: sql`excluded.minutes`,
          note,
          pending: sql`excluded.pending`,
          updatedAt: new Date(),
        },
      })
      .returning();

    return {
      days,
      totalDays: preview.totalDays,
      undo: stateOf(preview.written, existing),
      calendar: owesCalendar,
    };
  });
}

/**
 * Removes one row, or everything on one day, and says what the day held before.
 *
 * The removal itself is {@link deleteLeaveDay} and {@link clearDay}, unchanged: what the calendar knows
 * goes the long way round. Only the state before is new, for the toast's "Undo".
 */
export async function removeLeave(
  ctx: Pick<Ctx, "userId">,
  target: { id: string } | { date: CivilDate },
): Promise<{ deleted: number; pending: number; undo: LeaveUndo }> {
  let date: CivilDate;
  if ("id" in target) {
    const [row] = await getDb()
      .select({ on: leaveDays.on })
      .from(leaveDays)
      .where(and(eq(leaveDays.id, target.id), userScoped(ctx).owns(leaveDays)));
    if (!row) throw new TimeOffError("not_found");
    date = row.on;
  } else {
    date = target.date;
  }
  const before = await listLeaveDays(ctx, { from: date, to: date });
  const undo = stateOf([date], before);

  if ("id" in target) {
    const outcome = await deleteLeaveDay(ctx, target.id);
    return { deleted: outcome === "deleted" ? 1 : 0, pending: outcome === "pending" ? 1 : 0, undo };
  }
  return { ...(await clearDay(ctx, date)), undo };
}

/**
 * Removes every row still booked between two dates, in one transaction: all of them, or none
 * (decision of 17/11/2026, spec N5 §7.5). Each row goes the way "Remove" takes one — at once when
 * The calendar never heard of it, marked `pending = 'delete'` when it did — so the calendar is told one row at a
 * time, by the next pass, as for a single day. The answer carries the days as they were, for the
 * toast's "Undo", and how many dates lost something.
 */
export async function removeLeaveRange(
  ctx: Pick<Ctx, "userId">,
  input: { from: CivilDate; to: CivilDate },
): Promise<{ days: number; deleted: number; pending: number; undo: LeaveUndo | null }> {
  const parsed = leaveRemovalRangeSchema.safeParse(input);
  if (!parsed.success) throw new TimeOffError("invalid_input");
  const { from, to } = parsed.data;
  if (datesBetween(from, to).length > MAX_RANGE_DAYS) throw new TimeOffError("range_too_long");

  return getDb().transaction(async (tx) => {
    const existing = await rowsOn(tx, ctx, and(gte(leaveDays.on, from), lte(leaveDays.on, to)));
    const booked = existing.filter(stillBooked);
    const dates = [...new Set(booked.map((row) => row.on))];
    if (dates.length === 0) return { days: 0, deleted: 0, pending: 0, undo: null };

    let deleted = 0;
    let pending = 0;
    for (const row of booked) {
      if ((await takeAway(tx, ctx, row)) === "pending") pending += 1;
      else deleted += 1;
    }
    return { days: dates.length, deleted, pending, undo: stateOf(dates, existing) };
  });
}

/**
 * "Undo": puts the touched days back as they were, in one transaction.
 *
 * The calendar is never called from here. A row that was created and is not wanted goes the way any
 * removed row goes; a row that is wanted again comes back `pending = 'upsert'` when its kind
 * reaches the calendar — whether it was waiting for removal or had been deleted outright — and the next
 * pass, which always reads before it writes, settles it against what the calendar really holds. What the calendar
 * was observed holding is never restated: it is still on the row, or the row is new to the calendar.
 */
export async function restoreLeave(
  ctx: Pick<Ctx, "userId">,
  input: LeaveUndo,
): Promise<{ calendar: boolean }> {
  const parsed = leaveUndoSchema.safeParse(input);
  if (!parsed.success) throw new TimeOffError("invalid_input");
  const { dates, rows: wanted } = parsed.data;

  const { types, settings, holidays } = await leaveContext(ctx, [
    ...new Set(dates.map((date) => Number(date.slice(0, 4)))),
  ]);
  const { minutesPerDay } = await getPreferences(ctx);

  return getDb().transaction(async (tx) => {
    const current = await rowsOn(tx, ctx, inArray(leaveDays.on, dates));
    let owesCalendar = false;

    for (const row of current) {
      const kept = wanted.some((one) => one.on === row.on && one.typeId === row.typeId);
      if (kept || row.pending === "delete") continue;
      if ((await takeAway(tx, ctx, row)) === "pending") owesCalendar = true;
    }

    for (const one of wanted) {
      const row = current.find((held) => held.on === one.on && held.typeId === one.typeId);
      const values = rowOf(
        typeIn(types, one.typeId),
        { fraction: one.fraction, minutes: one.minutes ?? null },
        minutesPerDay,
      );
      if (
        row !== undefined &&
        row.pending !== "delete" &&
        row.fraction === values.fraction &&
        row.minutes === values.minutes &&
        row.note === one.note
      ) {
        continue;
      }
      // A row that is not there any more was never the calendar's: it is booked again, and only on a day
      // that can be booked — an undo is not a way round the calendar.
      if (row === undefined) {
        const verdict = bookable(one.on, holidays, settings.workDays);
        if (!verdict.ok) throw new TimeOffError("not_bookable", [{ on: one.on, reason: verdict.reason }]);
      }
      if (values.pending === "upsert") owesCalendar = true;
      await tx
        .insert(leaveDays)
        .values(userScoped(ctx).stamp({ on: one.on, ...values, note: one.note }))
        .onConflictDoUpdate({
          target: [leaveDays.userId, leaveDays.on, leaveDays.typeId],
          set: {
            fraction: values.fraction,
            minutes: values.minutes,
            note: one.note,
            pending: values.pending,
            updatedAt: new Date(),
          },
        });
    }
    return { calendar: owesCalendar };
  });
}

/** Whether a write left the external calendar something to hear (TOF-2). */
export const toldCalendar = (result: { calendar: boolean }): boolean => result.calendar;
