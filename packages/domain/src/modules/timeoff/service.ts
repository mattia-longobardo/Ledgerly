import { and, asc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { getPreferences } from "../users/service";
import { holidaysFor } from "../../platform/holidays/service";
import type { Ctx } from "../../platform/context";
import type { CivilDate } from "../../shared/dates";
import { getDb, type Tx } from "../../platform/db/client";
import { userScoped } from "../../platform/db/scope";
import {
  type AllowanceInput,
  type LeaveDayKind,
  type LeaveDayView,
  type LeaveInput,
  type LeaveRangeFields,
  type LeaveUndo,
  MAX_RANGE_DAYS,
  allowanceInputSchema,
  bookable,
  datesBetween,
  goesToTrek,
  leaveInputSchema,
  leaveRangeInputSchema,
  leaveRemovalRangeSchema,
  leaveUndoSchema,
  previewLeaveRange,
  rangeParts,
  stillBooked,
} from "./rules";
import { leaveDays, timeoffAllowances } from "./schema";

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

interface LeaveWindow {
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

/* What a Trek pass needs from this module (plan F7 §3.3) */

/** One of this user's days as a Trek pass needs to see it. */
export interface TrekDay {
  id: string;
  on: CivilDate;
  kind: LeaveDayKind;
  fraction: number | null;
  pending: "none" | "upsert" | "delete";
  /** The pair Trek was last observed holding, which is what a deletion has to send back. */
  trekFraction: number | null;
  trekKind: LeaveDayKind | null;
}

async function daysForTrek(
  ctx: Pick<Ctx, "userId">,
  window: LeaveWindow,
  onlyPending: boolean,
): Promise<TrekDay[]> {
  const rows = await getDb()
    .select({
      id: leaveDays.id,
      on: leaveDays.on,
      kind: leaveDays.kind,
      fraction: leaveDays.fraction,
      pending: leaveDays.pending,
      trekFraction: leaveDays.trekFraction,
      trekKind: leaveDays.trekKind,
    })
    .from(leaveDays)
    .where(
      and(
        userScoped(ctx).owns(leaveDays),
        gte(leaveDays.on, window.from),
        lte(leaveDays.on, window.to),
        onlyPending ? ne(leaveDays.pending, "none") : undefined,
      ),
    )
    .orderBy(asc(leaveDays.on), asc(leaveDays.kind), asc(leaveDays.id));

  return rows
    .filter((row) => goesToTrek(row.kind))
    .map((row) => ({
      id: row.id,
      on: row.on,
      kind: row.kind,
      fraction: row.fraction === null ? null : Number(row.fraction),
      pending: row.pending,
      trekFraction: row.trekFraction === null ? null : Number(row.trekFraction),
      trekKind: row.trekKind,
    }));
}

/**
 * Every day of a year the next pass owes Trek something for, oldest first. Only the kinds Trek
 * knows: a ROL row never carries a pending state, but the filter is stated here too so a future
 * kind cannot leak into a request by forgetting one (spec §9.2).
 */
export function pendingForTrek(ctx: Pick<Ctx, "userId">, window: LeaveWindow): Promise<TrekDay[]> {
  return daysForTrek(ctx, window, true);
}

/**
 * Every Trek-eligible day of a year, pending or not — what a pass diffs against the year Trek
 * reports. The whole set and not only the pending ones, because a day Trek has quietly lost is
 * one we still hold and still want: the diff puts it back without anybody having to notice first.
 */
export function trekDaysOf(ctx: Pick<Ctx, "userId">, window: LeaveWindow): Promise<TrekDay[]> {
  return daysForTrek(ctx, window, false);
}

/** Every date in a year this user holds a day on, whatever its kind — the conflict check's input. */
export async function datesHeld(ctx: Pick<Ctx, "userId">, window: LeaveWindow): Promise<Set<CivilDate>> {
  const rows = await getDb()
    .select({ on: leaveDays.on })
    .from(leaveDays)
    .where(
      and(userScoped(ctx).owns(leaveDays), gte(leaveDays.on, window.from), lte(leaveDays.on, window.to)),
    );
  return new Set(rows.map((row) => row.on));
}

/** How many days are waiting to be sent to Trek or taken back from it. */
export async function pendingCount(ctx: Pick<Ctx, "userId">): Promise<number> {
  const rows = await getDb()
    .select({ id: leaveDays.id })
    .from(leaveDays)
    .where(and(userScoped(ctx).owns(leaveDays), ne(leaveDays.pending, "none")));
  return rows.length;
}

/** The years this user has a day waiting to be sent or taken back in, oldest first. */
export async function yearsWithPending(ctx: Pick<Ctx, "userId">): Promise<number[]> {
  const rows = await getDb()
    .select({ on: leaveDays.on })
    .from(leaveDays)
    .where(and(userScoped(ctx).owns(leaveDays), ne(leaveDays.pending, "none")))
    .orderBy(asc(leaveDays.on));
  return [...new Set(rows.map((row) => Number(row.on.slice(0, 4))))].sort((a, b) => a - b);
}

/** What a pass observed about one day once it had re-read the year. */
export interface Observed {
  id: string;
  /** What Trek holds now, or `null` when Trek no longer holds the day at all. */
  fraction: number | null;
  kind: LeaveDayKind | null;
}

/**
 * Applies the outcome of a pass: a day Trek now holds as we meant it becomes `pending = 'none'`
 * with the observed pair recorded; a day Trek no longer holds, and that we had asked it to
 * remove, is finally deleted.
 *
 * Nothing here decides anything — the pass has already re-read Trek and worked out what is true.
 * This only writes it down, in one transaction so a half-applied outcome cannot be read.
 */
export async function markSynced(
  ctx: Pick<Ctx, "userId">,
  observed: readonly Observed[],
  now: Date = new Date(),
): Promise<void> {
  if (observed.length === 0) return;
  const gone = observed.filter((one) => one.kind === null).map((one) => one.id);
  const held = observed.filter((one) => one.kind !== null);

  await getDb().transaction(async (tx) => {
    for (const one of held) {
      await tx
        .update(leaveDays)
        .set({
          pending: "none",
          syncedAt: now,
          trekFraction: one.fraction === null ? null : one.fraction.toFixed(1),
          trekKind: one.kind as "vacation" | "comp",
          updatedAt: now,
        })
        .where(and(eq(leaveDays.id, one.id), userScoped(ctx).owns(leaveDays)));
    }
    if (gone.length > 0) {
      await tx.delete(leaveDays).where(and(inArray(leaveDays.id, gone), userScoped(ctx).owns(leaveDays)));
    }
  });
}

/**
 * Records a day a pass found on Trek that we did not have (plan F7 §3.4.7.4). It arrives already
 * reconciled: `origin = 'trek'`, nothing pending, and the observed pair is what Trek showed.
 *
 * A day we already hold under a **different** kind is left alone and reported back instead of
 * being rewritten: our classification wins, and a Trek `comp` we keep as ROL is a case for a human
 * to look at, not for the sync to resolve (plan F7 §3.6.3).
 */
export async function recordFromTrek(
  ctx: Pick<Ctx, "userId">,
  day: { on: CivilDate; kind: "vacation" | "comp"; fraction: number },
  now: Date = new Date(),
): Promise<LeaveDay | null> {
  const [row] = await getDb()
    .insert(leaveDays)
    .values(
      userScoped(ctx).stamp({
        on: day.on,
        kind: day.kind,
        fraction: day.fraction.toFixed(1),
        origin: "trek" as const,
        pending: "none" as const,
        syncedAt: now,
        trekFraction: day.fraction.toFixed(1),
        trekKind: day.kind,
      }),
    )
    .onConflictDoUpdate({
      target: [leaveDays.userId, leaveDays.on, leaveDays.kind],
      set: {
        fraction: day.fraction.toFixed(1),
        pending: "none",
        syncedAt: now,
        trekFraction: day.fraction.toFixed(1),
        trekKind: day.kind,
        updatedAt: now,
      },
    })
    .returning();
  return row ?? null;
}

/**
 * Closes every pending removal of this user, by really removing the days (plan F7 §3.4.10).
 * Called when Trek is unlinked: a row waiting for a pass that will never come would sit in the
 * table for ever, and there is no longer anybody to ask.
 */
export async function closePendingDeletes(ctx: Pick<Ctx, "userId">): Promise<number> {
  const removed = await getDb()
    .delete(leaveDays)
    .where(and(userScoped(ctx).owns(leaveDays), eq(leaveDays.pending, "delete")))
    .returning({ id: leaveDays.id });
  return removed.length;
}

/**
 * "Turn off" the source of the days (plugin-settings.md §3.2), inside the caller's transaction: a
 * removal still waiting goes for real (as `closePendingDeletes`), and a change still waiting stays
 * as it is here, never sent. The days stay days of Ledgerly, so the residual does not move.
 * Returns how many changes will not reach the source.
 */
export async function forgetPendingDays(
  tx: Tx,
  ctx: Pick<Ctx, "userId">,
  now: Date = new Date(),
): Promise<number> {
  const removed = await tx
    .delete(leaveDays)
    .where(and(userScoped(ctx).owns(leaveDays), eq(leaveDays.pending, "delete")))
    .returning({ id: leaveDays.id });
  const kept = await tx
    .update(leaveDays)
    .set({ pending: "none", updatedAt: now })
    .where(and(userScoped(ctx).owns(leaveDays), ne(leaveDays.pending, "none")))
    .returning({ id: leaveDays.id });
  return removed.length + kept.length;
}

/* A whole day, and a whole range (rewrite plan N5) */

/**
 * Everything on one day goes: what Delete on a day of the calendar asks for.
 *
 * Whatever Trek knows about goes the long way round — marked for removal and taken away once Trek
 * confirms — and whatever it never had simply goes. The counts come back so the caller knows
 * whether a Trek pass is worth starting at all.
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

const asView = (row: LeaveDay): LeaveDayView => ({
  on: row.on,
  kind: row.kind,
  fraction: Number(row.fraction),
});

/** The rows a person still means to keep, as "Undo" will be handed them back. */
function stateOf(dates: readonly CivilDate[], rows: readonly LeaveDay[]): LeaveUndo {
  return {
    dates: [...dates],
    rows: rows
      // A row waiting for Trek to let it go is already removed as far as its owner is concerned.
      .filter((row) => row.pending !== "delete" && dates.includes(row.on))
      .map((row) => ({ on: row.on, kind: row.kind, fraction: Number(row.fraction), note: row.note })),
  };
}

/** {@link deleteLeaveDay} for a row already read, inside the caller's transaction. */
async function takeAway(
  tx: Transaction,
  ctx: Pick<Ctx, "userId">,
  row: LeaveDay,
): Promise<"deleted" | "pending"> {
  const mine = and(eq(leaveDays.id, row.id), userScoped(ctx).owns(leaveDays));
  if (row.origin !== "trek" && row.syncedAt === null) {
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
    .orderBy(asc(leaveDays.on), asc(leaveDays.kind), asc(leaveDays.id))
    .for("update");
}

interface LeaveRangeResult {
  /** The rows written, one per working day of the range. */
  days: LeaveDay[];
  /** What the range comes to, in days. */
  totalDays: number;
  /** What the touched days held before, for "Undo". */
  undo: LeaveUndo;
  /** Whether the next Trek pass has something to do, and so is worth starting now. */
  trek: boolean;
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
 * Trek never heard of it, marked for removal when it did. Nothing is said to Trek from here.
 */
export async function saveLeaveRange(
  ctx: Pick<Ctx, "userId">,
  input: LeaveRangeFields,
): Promise<LeaveRangeResult> {
  const parsed = leaveRangeInputSchema.safeParse(input);
  if (!parsed.success) throw new TimeOffError("invalid_input");
  const { from, to, kind, fraction } = parsed.data;
  const otherKind = parsed.data.otherKind ?? null;
  const note = parsed.data.note ?? null;

  const span = datesBetween(from, to);
  if (span.length > MAX_RANGE_DAYS) throw new TimeOffError("range_too_long");
  const { patronSaint } = await getPreferences(ctx);
  // A range can cross new year, so both years are asked for.
  const years = [...new Set(span.map((date) => Number(date.slice(0, 4))))];
  const holidays = await holidaysFor(ctx, years, patronSaint);

  return getDb().transaction(async (tx) => {
    const existing = await rowsOn(tx, ctx, and(gte(leaveDays.on, from), lte(leaveDays.on, to)));
    const preview = previewLeaveRange(
      { from, to, kind, fraction, otherKind, editedKind: parsed.data.editedKind ?? null },
      // The panel works from the rows still booked; the server answers from the same ones.
      { days: existing.filter(stillBooked).map(asView), holidays },
    );
    if (preview.written.length === 0) throw new TimeOffError("not_bookable", preview.excluded);

    const parts = rangeParts({ kind, fraction, otherKind });
    let toldTrek = parts.some((part) => goesToTrek(part.kind));
    for (const gone of preview.removed) {
      const row = existing.find((one) => one.on === gone.on && one.kind === gone.kind);
      if (row !== undefined && (await takeAway(tx, ctx, row)) === "pending") toldTrek = true;
    }

    const days = await tx
      .insert(leaveDays)
      .values(
        preview.written.flatMap((on) =>
          parts.map((part) =>
            userScoped(ctx).stamp({
              on,
              kind: part.kind,
              fraction: part.fraction.toFixed(1),
              note,
              pending: goesToTrek(part.kind) ? ("upsert" as const) : ("none" as const),
            }),
          ),
        ),
      )
      .onConflictDoUpdate({
        target: [leaveDays.userId, leaveDays.on, leaveDays.kind],
        // Each row keeps its own values: `excluded` is the row that was about to be inserted.
        set: {
          fraction: sql`excluded.fraction`,
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
      trek: toldTrek,
    };
  });
}

/**
 * Removes one row, or everything on one day, and says what the day held before.
 *
 * The removal itself is {@link deleteLeaveDay} and {@link clearDay}, unchanged: what Trek knows
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
 * Trek never heard of it, marked `pending = 'delete'` when it did — so Trek is told one row at a
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
 * Trek is never called from here. A row that was created and is not wanted goes the way any
 * removed row goes; a row that is wanted again comes back `pending = 'upsert'` when its kind
 * reaches Trek — whether it was waiting for removal or had been deleted outright — and the next
 * pass, which always reads before it writes, settles it against what Trek really holds. What Trek
 * was observed holding is never restated: it is still on the row, or the row is new to Trek.
 */
export async function restoreLeave(ctx: Pick<Ctx, "userId">, input: LeaveUndo): Promise<{ trek: boolean }> {
  const parsed = leaveUndoSchema.safeParse(input);
  if (!parsed.success) throw new TimeOffError("invalid_input");
  const { dates, rows: wanted } = parsed.data;

  const { patronSaint } = await getPreferences(ctx);
  const years = [...new Set(dates.map((date) => Number(date.slice(0, 4))))];
  const holidays = await holidaysFor(ctx, years, patronSaint);

  return getDb().transaction(async (tx) => {
    const current = await rowsOn(tx, ctx, inArray(leaveDays.on, dates));
    let toldTrek = false;

    for (const row of current) {
      const kept = wanted.some((one) => one.on === row.on && one.kind === row.kind);
      if (kept || row.pending === "delete") continue;
      if ((await takeAway(tx, ctx, row)) === "pending") toldTrek = true;
    }

    for (const one of wanted) {
      const row = current.find((held) => held.on === one.on && held.kind === one.kind);
      const fraction = one.fraction.toFixed(1);
      if (
        row !== undefined &&
        row.pending !== "delete" &&
        row.fraction === fraction &&
        row.note === one.note
      ) {
        continue;
      }
      // A row that is not there any more was never Trek's: it is booked again, and only on a day
      // that can be booked — an undo is not a way round the calendar.
      if (row === undefined) {
        const verdict = bookable(one.on, holidays);
        if (!verdict.ok) throw new TimeOffError("not_bookable", [{ on: one.on, reason: verdict.reason }]);
      }
      const pending = goesToTrek(one.kind) ? ("upsert" as const) : ("none" as const);
      if (pending === "upsert") toldTrek = true;
      await tx
        .insert(leaveDays)
        .values(userScoped(ctx).stamp({ on: one.on, kind: one.kind, fraction, note: one.note, pending }))
        .onConflictDoUpdate({
          target: [leaveDays.userId, leaveDays.on, leaveDays.kind],
          set: { fraction, note: one.note, pending, updatedAt: new Date() },
        });
    }
    return { trek: toldTrek };
  });
}
