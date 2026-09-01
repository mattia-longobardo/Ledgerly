import { and, asc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { leaveDays } from "@/lib/db/schema";
import type { LeaveFraction, LeaveKind } from "@/lib/clients/trek";

export type PendingOp = "none" | "upsert" | "delete";
export type LeaveOrigin = "trek" | "dashboard";

/** The row as the rest of the app wants it: `fraction` already a number. */
export interface LeaveDayRow {
  date: string;
  fraction: LeaveFraction;
  kind: LeaveKind;
  trekEntryId: number | null;
  origin: LeaveOrigin;
  note: string | null;
  pendingOp: PendingOp;
  syncedAt: Date | null;
}

/**
 * pg `numeric` crosses the wire as a string; this is the single place it becomes
 * a number again. Anything that is not exactly Trek's half day is a full day,
 * matching both the CHECK constraint and Trek's own server-side coercion.
 */
function toFraction(raw: string): LeaveFraction {
  return Number(raw) === 0.5 ? 0.5 : 1;
}

function toRow(r: typeof leaveDays.$inferSelect): LeaveDayRow {
  return {
    date: r.date,
    fraction: toFraction(r.fraction),
    kind: r.kind === "comp" ? "comp" : "vacation",
    trekEntryId: r.trekEntryId,
    origin: r.origin === "dashboard" ? "dashboard" : "trek",
    note: r.note,
    pendingOp: r.pendingOp === "upsert" || r.pendingOp === "delete" ? r.pendingOp : "none",
    syncedAt: r.syncedAt,
  };
}

/** numeric(2,1) wants a plain decimal string, never a localised one. */
function fractionString(fraction: LeaveFraction): string {
  return fraction.toFixed(1);
}

export async function daysInRange(from: string, to: string): Promise<LeaveDayRow[]> {
  const rows = await db
    .select()
    .from(leaveDays)
    .where(and(gte(leaveDays.date, from), lte(leaveDays.date, to)))
    .orderBy(asc(leaveDays.date));
  return rows.map(toRow);
}

export async function daysInYear(year: number): Promise<LeaveDayRow[]> {
  return daysInRange(`${year}-01-01`, `${year}-12-31`);
}

/**
 * The oldest day the mirror has ever held, across every year — or null when the
 * calendar is empty.
 *
 * This is what "the calendar covers this month" has to be derived from. The
 * first BOOKING of the year on screen is a different thing entirely: a year
 * whose first day off falls in June is fully covered from January, and an empty
 * February in it means zero days planned, not "no calendar". Reading the first
 * booking instead is what let a payslip reporting ferie in February pass
 * unflagged every January-to-first-booking window.
 *
 * A row staged for deletion still counts: the calendar did cover that day, and
 * the coverage boundary is about history, not about what is booked right now.
 */
export async function earliestDate(): Promise<string | null> {
  const [row] = await db
    .select({ date: leaveDays.date })
    .from(leaveDays)
    .orderBy(asc(leaveDays.date))
    .limit(1);
  return row?.date ?? null;
}

export async function dayAt(date: string): Promise<LeaveDayRow | null> {
  const rows = await daysInRange(date, date);
  return rows[0] ?? null;
}

/** Everything the push has to send upstream, oldest date first. */
export async function pendingDays(): Promise<LeaveDayRow[]> {
  const rows = await db
    .select()
    .from(leaveDays)
    .where(ne(leaveDays.pendingOp, "none"))
    .orderBy(asc(leaveDays.date));
  return rows.map(toRow);
}

export interface UpsertFromTrekInput {
  date: string;
  fraction: LeaveFraction;
  kind: LeaveKind;
  trekEntryId: number;
  note: string | null;
}

/**
 * Writes what Trek says, and clears any pending flag on the way through: a row
 * only reaches here after the push has already run, so whatever Trek reports at
 * that point IS the settled state.
 */
export async function upsertFromTrek(rows: readonly UpsertFromTrekInput[], now = new Date()) {
  if (rows.length === 0) return;
  await db
    .insert(leaveDays)
    .values(
      rows.map((r) => ({
        date: r.date,
        fraction: fractionString(r.fraction),
        kind: r.kind,
        trekEntryId: r.trekEntryId,
        origin: "trek" as const,
        note: r.note,
        pendingOp: "none" as const,
        syncedAt: now,
        updatedAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: leaveDays.date,
      set: {
        fraction: sql`excluded.fraction`,
        kind: sql`excluded.kind`,
        trekEntryId: sql`excluded.trek_entry_id`,
        note: sql`excluded.note`,
        pendingOp: sql`excluded.pending_op`,
        syncedAt: sql`excluded.synced_at`,
        updatedAt: sql`excluded.updated_at`,
        // `origin` is deliberately NOT overwritten: it records who first put the
        // day on the calendar, which stays true after Trek confirms it.
      },
    });
}

export async function deleteDates(dates: readonly string[]) {
  if (dates.length === 0) return;
  await db.delete(leaveDays).where(inArray(leaveDays.date, [...dates]));
}

export interface StageUpsertInput {
  date: string;
  fraction: LeaveFraction;
  kind: LeaveKind;
  note?: string | null;
}

/** A day set from the dashboard: written locally first, pushed to Trek after. */
export async function stageUpsert(input: StageUpsertInput, now = new Date()) {
  const [row] = await db
    .insert(leaveDays)
    .values({
      date: input.date,
      fraction: fractionString(input.fraction),
      kind: input.kind,
      origin: "dashboard",
      note: input.note ?? null,
      pendingOp: "upsert",
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: leaveDays.date,
      set: {
        fraction: sql`excluded.fraction`,
        kind: sql`excluded.kind`,
        note: sql`excluded.note`,
        pendingOp: sql`excluded.pending_op`,
        updatedAt: sql`excluded.updated_at`,
      },
    })
    .returning();
  return row ? toRow(row) : null;
}

/**
 * Marks a day for removal WITHOUT deleting the row — the push still needs its
 * current fraction and kind to build the toggle that removes it upstream.
 */
export async function stageDelete(date: string, now = new Date()) {
  const [row] = await db
    .update(leaveDays)
    .set({ pendingOp: "delete", updatedAt: now })
    .where(eq(leaveDays.date, date))
    .returning();
  return row ? toRow(row) : null;
}

/** Clears a pending flag after Trek has confirmed it, without touching values. */
export async function clearPending(dates: readonly string[], now = new Date()) {
  if (dates.length === 0) return;
  await db
    .update(leaveDays)
    .set({ pendingOp: "none", syncedAt: now, updatedAt: now })
    .where(inArray(leaveDays.date, [...dates]));
}
