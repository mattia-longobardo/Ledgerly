/**
 * Trek leave sync — the I/O half. Every decision it makes lives in
 * `trek-diff.ts`; read the policy comment at the top of that file first.
 *
 * Exposed as a plain async function rather than a registered job on purpose:
 * `JobName` lives in `contracts.ts`, which is owned by another workstream this
 * phase. `runTrekSync()` takes no ambient state and returns a plain result, so
 * wiring it to cron later is an import and a union entry — no refactor. The
 * "Sync now" server action calls exactly this function today.
 *
 * ⚠ THE LOCK LIVES HERE, not in the job wrapper. A pass is a
 * read → diff → toggle over one year, and Trek's toggle is its own inverse: two
 * passes racing over the same day make the second one UNDO what the first just
 * booked, after which the pull deletes it locally too and the booking is gone
 * from both sides. The job wrapper is only one of the callers — the dashboard's
 * Save, Remove and "Sync now" all start a pass as well — so a lock held there
 * would guard the cron entry against itself and nothing else. Held at the one
 * function every caller has to go through, there is no unlocked route left.
 */

import {
  applyDesiredState,
  getEntries,
  getStats,
  type TrekCallOptions,
  type TrekYearStats,
} from "@/lib/clients/trek";
import { withJobLock } from "@/lib/repo/jobs";
import * as leave from "@/lib/repo/leave";
import { setCachedTrekStats } from "@/lib/repo/trek-state";
import { planPull, planPush } from "./trek-diff";

/**
 * Same key the `trek_sync` job runs under — the cron pass and a dashboard edit
 * are the same critical section and must contend for the same lock.
 */
export const TREK_SYNC_LOCK_KEY = "trek_sync";

export type TrekSyncStatus =
  | "disabled"
  | "ok"
  | "partial"
  | "failed"
  /**
   * Another pass held the lock, so this one did nothing at all. Not a failure:
   * pending rows are still pending and the pass that owns the lock — or the
   * next one — delivers them.
   */
  | "skipped";

export interface TrekSyncResult {
  status: TrekSyncStatus;
  year: number;
  /** Rows written locally from Trek. */
  pulled: number;
  /** Local rows dropped because Trek no longer has them. */
  deleted: number;
  /** Local edits Trek accepted. */
  pushed: number;
  /** Dates Trek's plan refuses because they fall on a weekend. */
  weekendBlocked: string[];
  /** Dates whose local edit is still waiting — the next pass retries them. */
  stillPending: string[];
  /** Trek's own allowance/used/remaining; null when unavailable. */
  stats: TrekYearStats | null;
  errors: string[];
}

export interface RunTrekSyncInput {
  year?: number;
  now?: Date;
  /**
   * Skips `GET /stats/:year`, which has a write side effect upstream (it
   * persists carry-over). The UI wants the figures; a background pass need not
   * pay for them.
   */
  withStats?: boolean;
  /** The credential, resolved by the caller from the integration vault. */
  call: TrekCallOptions;
}

function empty(status: TrekSyncStatus, year: number): TrekSyncResult {
  return {
    status,
    year,
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
 * The only way to start a pass. Serialised against every other caller by the
 * advisory lock; see the ⚠ note at the top of the file for why it is held here
 * and not in the job wrapper.
 *
 * `pg_try_advisory_xact_lock` does not wait: a losing caller returns `skipped`
 * immediately, which is what makes it safe to hold this lock on the request
 * path of a dashboard Save. The WINNER, though, keeps a transaction — and so
 * one of the pool's eight connections — open for the whole Trek conversation.
 * That was already true of the hourly pass; it is now also true of a Save, so a
 * slow Trek costs a connection for as long as it is slow.
 */
export async function runTrekSync(input: RunTrekSyncInput): Promise<TrekSyncResult> {
  const year = input.year ?? (input.now ?? new Date()).getFullYear();
  const result = await withJobLock(TREK_SYNC_LOCK_KEY, () => syncPass(input, year));
  return result ?? empty("skipped", year);
}

/**
 * The result a caller reports when there is no Trek connection at all.
 *
 * `runTrekSync` used to decide this itself, by checking the environment for a
 * configured Trek credential directly. It cannot any more — "is Trek set up"
 * is a question about `integration_connections`,
 * which this module knows nothing about — so the answer moved to the callers
 * that *can* ask it, and this is the shape they hand back. `TrekSyncStatus`
 * keeps its `"disabled"` member and the Work page keeps rendering "Trek sync is
 * off" from it; only the place the decision is taken has changed.
 */
export function disabledTrekSync(year: number): TrekSyncResult {
  return empty("disabled", year);
}

/** One full bidirectional pass: PUSH local edits, then PULL Trek's answer. */
async function syncPass(input: RunTrekSyncInput, year: number): Promise<TrekSyncResult> {
  const now = input.now ?? new Date();
  const opts = input.call;

  const result: TrekSyncResult = {
    status: "ok",
    year,
    pulled: 0,
    deleted: 0,
    pushed: 0,
    weekendBlocked: [],
    stillPending: [],
    stats: null,
    errors: [],
  };

  try {
    // ── 1. PUSH ──────────────────────────────────────────────────────────────
    // Only rows for this year: a pending edit in another year belongs to that
    // year's pass, and Trek's toggle is scoped by the entries read for a year.
    const pending = (await leave.pendingDays()).filter((r) => r.date.startsWith(`${year}-`));
    const stillPending = new Set<string>();

    if (pending.length > 0) {
      const push = planPush(pending);
      const applied = await applyDesiredState(
        { year, desired: push.desired, removals: push.removals },
        opts,
      );

      // Dates that no longer have anything to send: Trek accepted the toggle,
      // or never needed one. Cleared together below so a pushed edit does not
      // stay flagged and get re-sent on every later pass.
      const settled: string[] = [];

      for (const r of applied.results) {
        if (r.outcome === "applied") {
          result.pushed += 1;
          settled.push(r.date);
          continue;
        }
        if (r.outcome === "weekend_blocked") {
          // A domain outcome, not a failure. The day can never exist upstream,
          // so the local row is dropped rather than left pending forever —
          // otherwise every future pass would re-attempt a request Trek will
          // always refuse.
          result.weekendBlocked.push(r.date);
          continue;
        }
        stillPending.add(r.date);
        result.errors.push(`${r.date}: ${r.error ?? r.outcome}`);
      }

      // A day Trek already agreed with, or a removal for a day it no longer
      // has, needed no request — equally settled. `planPull` then treats every
      // one of these like any other clean row.
      settled.push(...applied.unchanged, ...applied.alreadyAbsent);
      if (settled.length > 0) await leave.clearPending(settled, now);

      if (result.weekendBlocked.length > 0) {
        await leave.deleteDates(result.weekendBlocked);
      }
    }

    result.stillPending = [...stillPending];

    // ── 2. PULL ──────────────────────────────────────────────────────────────
    const remote = await getEntries(year, opts);
    const local = await leave.daysInYear(year);
    const pull = planPull(local, remote, stillPending);

    await leave.upsertFromTrek(pull.upserts, now);
    await leave.deleteDates(pull.deletes);
    result.pulled = pull.upserts.length;
    result.deleted = pull.deletes.length;

    // ── 3. STATS (deliberate, once) ──────────────────────────────────────────
    if (input.withStats !== false) {
      result.stats = await getStats(year, opts);
      // Cached so the Work page can show Trek's figures without re-triggering
      // this endpoint's carry-over write on every render.
      if (result.stats !== null) await setCachedTrekStats(year, result.stats, now);
    }

    if (result.errors.length > 0) result.status = "partial";
    return result;
  } catch (err) {
    result.status = "failed";
    result.errors.push(err instanceof Error ? err.message : String(err));
    return result;
  }
}
