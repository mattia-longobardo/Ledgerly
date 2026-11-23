import { and, asc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import type { CivilDate } from "../../../shared/dates";
import { getDb, type Tx } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { type LeaveDayKind, goesToCalendar } from "../rules";
import { leaveDays } from "../schema";
import type { LeaveDay, LeaveWindow } from "./records";

/* What a pass of the calendar needs from this module (plan F7 §3.3) */

/** One of this user's days as a pass of the calendar needs to see it. */
interface CalendarDay {
  id: string;
  on: CivilDate;
  kind: LeaveDayKind;
  fraction: number | null;
  pending: "none" | "upsert" | "delete";
  /** The pair the calendar was last observed holding, which is what a deletion has to send back. */
  observedFraction: number | null;
  observedKind: LeaveDayKind | null;
}

async function daysForCalendar(
  ctx: Pick<Ctx, "userId">,
  window: LeaveWindow,
  onlyPending: boolean,
): Promise<CalendarDay[]> {
  const rows = await getDb()
    .select({
      id: leaveDays.id,
      on: leaveDays.on,
      kind: leaveDays.kind,
      fraction: leaveDays.fraction,
      pending: leaveDays.pending,
      observedFraction: leaveDays.observedFraction,
      observedKind: leaveDays.observedKind,
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
    .filter((row) => goesToCalendar(row.kind))
    .map((row) => ({
      id: row.id,
      on: row.on,
      kind: row.kind,
      fraction: row.fraction === null ? null : Number(row.fraction),
      pending: row.pending,
      observedFraction: row.observedFraction === null ? null : Number(row.observedFraction),
      observedKind: row.observedKind,
    }));
}

/**
 * Every day of a year the next pass owes the calendar something for, oldest first. Only the kinds the calendar
 * knows: a ROL row never carries a pending state, but the filter is stated here too so a future
 * kind cannot leak into a request by forgetting one (spec §9.2).
 */
export function pendingForCalendar(ctx: Pick<Ctx, "userId">, window: LeaveWindow): Promise<CalendarDay[]> {
  return daysForCalendar(ctx, window, true);
}

/**
 * Every calendar-eligible day of a year, pending or not — what a pass diffs against the year the calendar
 * reports. The whole set and not only the pending ones, because a day the calendar has quietly lost is
 * one we still hold and still want: the diff puts it back without anybody having to notice first.
 */
export function calendarDaysOf(ctx: Pick<Ctx, "userId">, window: LeaveWindow): Promise<CalendarDay[]> {
  return daysForCalendar(ctx, window, false);
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

/** How many days are waiting to be sent to the calendar or taken back from it. */
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

/**
 * The pair the calendar was observed holding, written twice (rewrite plan R5c, P2): the old
 * columns every read still uses, and the `external_*` ones that replace them in a later release.
 * Both always carry the same values; an observed pair is a settled one.
 */
function observedPair(fraction: string | null, kind: "vacation" | "comp") {
  return {
    observedFraction: fraction,
    observedKind: kind,
    externalFraction: fraction,
    externalKind: kind,
    externalState: "synced" as const,
  };
}

/** What a pass observed about one day once it had re-read the year. */
interface Observed {
  id: string;
  /** What the calendar holds now, or `null` when the calendar no longer holds the day at all. */
  fraction: number | null;
  kind: LeaveDayKind | null;
}

/**
 * Applies the outcome of a pass: a day the calendar now holds as we meant it becomes `pending = 'none'`
 * with the observed pair recorded; a day the calendar no longer holds, and that we had asked it to
 * remove, is finally deleted.
 *
 * Nothing here decides anything — the pass has already re-read the calendar and worked out what is true.
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
          ...observedPair(
            one.fraction === null ? null : one.fraction.toFixed(1),
            one.kind as "vacation" | "comp",
          ),
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
 * Marks the days the calendar does not take (a weekend, say): they stay owed, exactly as they were,
 * and say they were refused. The observed pair is not touched — nothing landed.
 */
export async function markRefused(ctx: Pick<Ctx, "userId">, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await getDb()
    .update(leaveDays)
    .set({ externalState: "refused" })
    .where(and(inArray(leaveDays.id, [...ids]), userScoped(ctx).owns(leaveDays)));
}

/**
 * Records a day a pass found on the calendar that we did not have (plan F7 §3.4.7.4). It arrives already
 * reconciled: `origin = 'external'` (since R5c P3; the old origin before), nothing pending, and the observed
 * pair is what the calendar showed.
 *
 * A day we already hold under a **different** kind is left alone and reported back instead of
 * being rewritten: our classification wins, and a calendar `comp` we keep as ROL is a case for a human
 * to look at, not for the sync to resolve (plan F7 §3.6.3).
 */
export async function recordFromCalendar(
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
        origin: "external" as const,
        pending: "none" as const,
        syncedAt: now,
        ...observedPair(day.fraction.toFixed(1), day.kind),
      }),
    )
    .onConflictDoUpdate({
      target: [leaveDays.userId, leaveDays.on, leaveDays.kind],
      set: {
        fraction: day.fraction.toFixed(1),
        pending: "none",
        syncedAt: now,
        ...observedPair(day.fraction.toFixed(1), day.kind),
        updatedAt: now,
      },
    })
    .returning();
  return row ?? null;
}

/**
 * Closes every pending removal of this user, by really removing the days (plan F7 §3.4.10).
 * Called when the calendar is unlinked: a row waiting for a pass that will never come would sit in the
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
