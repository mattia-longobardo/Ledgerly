"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/require-user";
import { isWeekendBlocked, trekConfigured } from "@/lib/clients/trek";
import { runTrekSync, type TrekSyncResult } from "@/lib/jobs/trek-sync";
import * as leave from "@/lib/repo/leave";
import { yearOf } from "@/lib/time";
import { errorMessage, fail, succeed, type ActionResult } from "./types";

const LEAVE_PATHS = ["/", "/work"] as const;

function revalidateLeave(): void {
  for (const path of LEAVE_PATHS) revalidatePath(path);
}

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Trek's fractions are its whole domain: 1 or 0.5, nothing between. `z.literal`
 * rather than a range check, so a 0.25 from a hand-crafted request is refused
 * here instead of being silently coerced to a full day by Trek's server.
 */
const daySchema = z.object({
  date: z.string().regex(isoDatePattern),
  fraction: z.union([z.literal(1), z.literal(0.5)]),
  kind: z.enum(["vacation", "comp"]),
  note: z.string().max(200).nullish(),
});

export interface LeaveDaySaved {
  date: string;
  /** True when the day was kept locally but Trek could not be told about it. */
  syncPending: boolean;
  /**
   * True when the push did not run at all because another pass owned the sync.
   * Distinct from `syncPending`, which also covers "Trek answered badly": this
   * one means nothing was even attempted, and the day is untouched upstream
   * until the pass that holds the lock — or the next hourly one — picks it up.
   */
  queued: boolean;
  /** Set when Trek's plan refuses the date; a message, never an error. */
  weekendBlocked: boolean;
  message: string;
  sync: TrekSyncResult;
}

/**
 * Sets (or changes) one leave day.
 *
 * Local-first, then push: the row is staged as `pending_op = 'upsert'` and the
 * sync sends it on. That ordering is what makes the edit survive Trek being
 * down — the day is already saved, and the next pass delivers it — and it is
 * the same path a cron run takes, so there is exactly one write route to Trek.
 *
 * It is also what makes losing the sync lock a non-event: `runTrekSync()` will
 * refuse to race the hourly pass and come back `skipped`, and because the row
 * is already staged that is reported as "saved, syncing shortly" rather than as
 * a failure. The owner's edit is never contingent on winning the race.
 */
export async function setLeaveDay(
  input: z.input<typeof daySchema>,
): Promise<ActionResult<LeaveDaySaved>> {
  await requireUser();

  const parsed = daySchema.safeParse(input);
  if (!parsed.success) {
    return fail("That is not a valid leave day. Pick a date, then a full or half day.");
  }
  const { date, fraction, kind, note } = parsed.data;

  // Refused before anything is written: Trek's plan blocks weekends, so staging
  // one would create a row that can never reach Trek and would be pulled away
  // again on the next pass. Told as a plain sentence, not an upstream error.
  if (isWeekendBlocked(date)) {
    return succeed({
      date,
      syncPending: false,
      queued: false,
      weekendBlocked: true,
      message: "Trek's leave plan blocks weekends, so Saturdays and Sundays can't be booked.",
      sync: await noopSync(date),
    });
  }

  try {
    await leave.stageUpsert({ date, fraction, kind, note: note ?? null });
  } catch (err) {
    return fail(errorMessage(err));
  }

  const sync = await runTrekSync({ year: yearOf(date), withStats: false });
  revalidateLeave();

  return succeed({
    date,
    syncPending: sync.status !== "ok",
    queued: sync.status === "skipped",
    weekendBlocked: sync.weekendBlocked.includes(date),
    message: describe(sync, "Day saved"),
    sync,
  });
}

const removeSchema = z.object({ date: z.string().regex(isoDatePattern) });

/**
 * Removes a leave day.
 *
 * The local row is FLAGGED, not deleted: Trek has no DELETE verb, and the only
 * way to remove a day there is to toggle it with its current fraction and kind
 * — which nothing but this row still remembers. It is dropped for real once
 * Trek confirms, inside the pull.
 */
export async function removeLeaveDay(
  input: z.input<typeof removeSchema>,
): Promise<ActionResult<LeaveDaySaved>> {
  await requireUser();

  const parsed = removeSchema.safeParse(input);
  if (!parsed.success) return fail("That is not a valid date.");
  const { date } = parsed.data;

  const existing = await leave.dayAt(date);
  if (existing === null) return fail("There is no leave booked on that day.");

  try {
    await leave.stageDelete(date);
  } catch (err) {
    return fail(errorMessage(err));
  }

  const sync = await runTrekSync({ year: yearOf(date), withStats: false });
  revalidateLeave();

  return succeed({
    date,
    syncPending: sync.status !== "ok",
    queued: sync.status === "skipped",
    weekendBlocked: false,
    message: describe(sync, "Day removed"),
    sync,
  });
}

const syncSchema = z.object({ year: z.number().int().min(2000).max(2100).optional() });

/**
 * The in-app "Sync now". Identical to what a scheduled run will call — the job
 * is a plain function precisely so the two cannot drift apart, and both contend
 * for the same lock, so pressing this while the hourly pass runs comes back
 * `skipped` instead of starting a second conversation with Trek.
 */
export async function syncLeaveNow(
  input: z.input<typeof syncSchema> = {},
): Promise<ActionResult<TrekSyncResult>> {
  await requireUser();

  const parsed = syncSchema.safeParse(input);
  if (!parsed.success) return fail("That is not a valid year.");

  try {
    const sync = await runTrekSync({
      ...(parsed.data.year !== undefined ? { year: parsed.data.year } : {}),
    });
    revalidateLeave();
    if (sync.status === "failed") {
      return fail(sync.errors[0] ?? "The leave sync failed. Trek did not answer.");
    }
    return succeed(sync);
  } catch (err) {
    return fail(errorMessage(err));
  }
}

/** A day refused locally never reaches Trek, so it reports an untouched pass. */
async function noopSync(date: string): Promise<TrekSyncResult> {
  return {
    status: trekConfigured() ? "ok" : "disabled",
    year: yearOf(date),
    pulled: 0,
    deleted: 0,
    pushed: 0,
    weekendBlocked: [],
    stillPending: [],
    stats: null,
    errors: [],
  };
}

/**
 * One sentence the owner can act on. "Saved but not synced" is a success with a
 * caveat, not a failure — the edit is safely in Postgres either way.
 */
function describe(sync: TrekSyncResult, done: string): string {
  if (sync.status === "disabled") return `${done} on the dashboard. Trek sync is off.`;
  if (sync.status === "ok") return `${done} and sent to Trek.`;
  // Another pass held the lock, so nothing was pushed — deliberately, to avoid
  // toggling the same day twice, which is how Trek deletes it. The row is
  // staged, so this is a wait, not a problem.
  if (sync.status === "skipped") return `${done}. A sync is already running — syncing shortly.`;
  return `${done}, but Trek could not be updated yet. It will be retried.`;
}
