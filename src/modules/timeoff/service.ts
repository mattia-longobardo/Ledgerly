import "server-only";
import { and, asc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { getPreferences } from "@/modules/users/service";
import { holidaysFor } from "@/platform/holidays/service";
import type { Ctx } from "@/platform/context";
import type { CivilDate } from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import {
  type AllowanceInput,
  type LeaveDayKind,
  type LeaveInput,
  allowanceInputSchema,
  bookable,
  datesBetween,
  goesToTrek,
  leaveInputSchema,
} from "./rules";
import { leaveDays, timeoffAllowances } from "./schema";

export type Allowance = typeof timeoffAllowances.$inferSelect;
export type LeaveDay = typeof leaveDays.$inferSelect;

export type TimeOffErrorCode =
  | "not_found"
  | "invalid_input"
  /** The date is a weekend or a public holiday: the reason travels with the error. */
  | "not_bookable"
  /** A range that would write more days than anyone books in one go. */
  | "range_too_long"
  /** A click cannot decide what that day should become: it carries something a dialog stated. */
  | "not_cyclable";

/** How many days one "Add leave" may write at once: a year of working days, and no more. */
export const MAX_RANGE_DAYS = 260;

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

/* What a click on the calendar does (N3) */

/** The two kinds a click walks between: the ones a person books over and over. */
const CLICK_KINDS = ["vacation", "rol"] as const;

/**
 * One click on a day (N3): nothing becomes a whole day of vacation, vacation becomes ROL, ROL
 * becomes vacation again.
 *
 * The decision is made here, from what is stored, and not in the browser from what it last drew:
 * two clicks racing each other then settle into one order instead of disagreeing about what the
 * day was. A day carrying anything else — sickness, a recovery day, two halves — is left exactly
 * as it is and reported, because a click is a shortcut for the ordinary case and must never
 * quietly throw away something a person took the trouble to state.
 */
export async function cycleDay(
  ctx: Pick<Ctx, "userId">,
  date: CivilDate,
): Promise<{ kind: LeaveDayKind | null }> {
  const { patronSaint } = await getPreferences(ctx);
  const holidays = await holidaysFor(ctx, [Number(date.slice(0, 4))], patronSaint);
  const verdict = bookable(date, holidays);
  if (!verdict.ok) throw new TimeOffError("not_bookable", [{ on: date, reason: verdict.reason }]);

  const existing = await getDb()
    .select()
    .from(leaveDays)
    .where(and(userScoped(ctx).owns(leaveDays), eq(leaveDays.on, date)));

  if (existing.length > 1) throw new TimeOffError("not_cyclable");
  const current = existing[0] ?? null;
  if (current !== null && !(CLICK_KINDS as readonly string[]).includes(current.kind)) {
    throw new TimeOffError("not_cyclable");
  }

  const next: LeaveDayKind = current === null ? "vacation" : current.kind === "vacation" ? "rol" : "vacation";
  // The fraction is kept: a half day that was clicked to change its kind is still a half day.
  const fraction = current?.fraction ?? "1.0";

  await getDb().transaction(async (tx) => {
    if (current !== null) {
      await tx.delete(leaveDays).where(and(eq(leaveDays.id, current.id), userScoped(ctx).owns(leaveDays)));
    }
    await tx.insert(leaveDays).values(
      userScoped(ctx).stamp({
        on: date,
        kind: next,
        fraction,
        note: current?.note ?? null,
        pending: goesToTrek(next) ? ("upsert" as const) : ("none" as const),
        // The row that was there is gone, so what Trek held is no longer this row's to claim.
        // The pass re-reads the year anyway; this only keeps the two from contradicting.
        syncedAt: current?.syncedAt ?? null,
        trekFraction: current?.trekFraction ?? null,
        trekKind: current?.trekKind ?? null,
      }),
    );
  });
  return { kind: next };
}

/**
 * The right button: everything on that day goes (N3).
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

/**
 * Held down, a day of vacation or ROL becomes half a day — and held again, a whole one back (N3).
 *
 * Only those two kinds and only one row: a day carrying something a dialog stated, or two halves
 * already, is refused rather than guessed at, exactly as {@link cycleDay} refuses it. Holding is
 * a shortcut for the one thing people do constantly, not a second way to edit anything.
 *
 * The row is updated rather than replaced, so what Trek was observed holding survives: the pass
 * still needs it to take the day back if the half turns out to be wrong.
 */
/**
 * The right button held down: half a day of vacation and half of ROL, the one day off that takes
 * two rows to say (N10).
 *
 * It is the commonest shape a click cannot reach — a morning of ROL and an afternoon of vacation
 * is two kinds on one date, and every other shortcut here deals in exactly one. Held again it goes
 * back to a whole day of vacation, the way holding the left button goes back to a whole day: a
 * gesture that cannot be undone by itself is a gesture people are afraid to try.
 *
 * What it refuses is what the other two refuse — sickness, a recovery day, anything a dialog
 * stated — because a shortcut must never quietly throw away something somebody took the trouble
 * to write down.
 */
export async function splitDay(ctx: Pick<Ctx, "userId">, date: CivilDate): Promise<{ split: boolean }> {
  const { patronSaint } = await getPreferences(ctx);
  const holidays = await holidaysFor(ctx, [Number(date.slice(0, 4))], patronSaint);
  const verdict = bookable(date, holidays);
  if (!verdict.ok) throw new TimeOffError("not_bookable", [{ on: date, reason: verdict.reason }]);

  const rows = await getDb()
    .select()
    .from(leaveDays)
    .where(and(userScoped(ctx).owns(leaveDays), eq(leaveDays.on, date)));

  if (rows.length > 2) throw new TimeOffError("not_cyclable");
  if (rows.some((row) => !(CLICK_KINDS as readonly string[]).includes(row.kind))) {
    throw new TimeOffError("not_cyclable");
  }

  // Already the two halves this gesture makes: holding again puts the day back together.
  const halves =
    rows.length === 2 && rows.every((row) => Number(row.fraction) === 0.5)
      ? new Set(rows.map((row) => row.kind))
      : null;
  const undo = halves !== null && halves.has("vacation") && halves.has("rol");
  if (rows.length === 2 && !undo) throw new TimeOffError("not_cyclable");

  const note = rows.find((row) => row.note !== null)?.note ?? null;
  const wanted = undo
    ? [{ kind: "vacation" as const, fraction: "1.0" }]
    : [
        { kind: "vacation" as const, fraction: "0.5" },
        { kind: "rol" as const, fraction: "0.5" },
      ];

  await getDb().transaction(async (tx) => {
    for (const row of rows) {
      await tx.delete(leaveDays).where(and(eq(leaveDays.id, row.id), userScoped(ctx).owns(leaveDays)));
    }
    for (const one of wanted) {
      // What Trek was observed holding belongs to the row of that kind, when there was one: the
      // pass needs the observed pair to take a day back, and a toggle sent blind recreates it.
      const previous = rows.find((row) => row.kind === one.kind) ?? null;
      await tx.insert(leaveDays).values(
        userScoped(ctx).stamp({
          on: date,
          kind: one.kind,
          fraction: one.fraction,
          note,
          pending: goesToTrek(one.kind) ? ("upsert" as const) : ("none" as const),
          syncedAt: previous?.syncedAt ?? null,
          trekFraction: previous?.trekFraction ?? null,
          trekKind: previous?.trekKind ?? null,
        }),
      );
    }
  });
  return { split: !undo };
}

export async function halveDay(ctx: Pick<Ctx, "userId">, date: CivilDate): Promise<{ fraction: number }> {
  const rows = await getDb()
    .select()
    .from(leaveDays)
    .where(and(userScoped(ctx).owns(leaveDays), eq(leaveDays.on, date)));

  if (rows.length !== 1) throw new TimeOffError("not_cyclable");
  const [current] = rows;
  if (!(CLICK_KINDS as readonly string[]).includes(current.kind)) throw new TimeOffError("not_cyclable");

  const next = Number(current.fraction) === 1 ? "0.5" : "1.0";
  await getDb()
    .update(leaveDays)
    .set({
      fraction: next,
      // The size changed, so Trek has something to hear about again.
      pending: goesToTrek(current.kind) ? "upsert" : "none",
      updatedAt: new Date(),
    })
    .where(and(eq(leaveDays.id, current.id), userScoped(ctx).owns(leaveDays)));
  return { fraction: Number(next) };
}
