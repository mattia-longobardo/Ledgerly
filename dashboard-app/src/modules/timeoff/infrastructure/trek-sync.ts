/**
 * Trek leave sync — the I/O half. Every decision it makes lives in
 * `trek-diff.ts`; read the policy comment at the top of that file first.
 *
 * Exposed as a plain async function rather than a registered job on purpose:
 * the calendar's owner and a `TimeoffStore` are arguments, not ambient state,
 * so every caller reaches the same function — the hourly `trek_sync` job
 * through the integration engine, and the workspace's "Sync now" (Task 4).
 *
 * ⚠ NO DATABASE HANDLE, and no `tx`. A pass alternates database steps with
 * Trek calls, and the shared conventions forbid network I/O inside an RLS
 * context. `store.withEvents()` opens one short context per database step and
 * closes it before the next network call; the numbered sections in `syncPass`
 * are that alternation, and `trek-sync.test.ts` fails the pass if a Trek call
 * ever happens with one open.
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
import { setCachedTrekStats } from "@/lib/repo/trek-state";
import { seedDefaultTypes } from "../application/ensure-default-types";
import type { TimeoffStore } from "../application/ports";
import { hoursPerDayString } from "./deps";
import {
  planPull,
  planPush,
  storedFraction,
  trekEvents,
  typeCodeOf,
  unpushableUpserts,
} from "./trek-diff";

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
  /** The owner of the calendar being synced. Every database step is scoped to them. */
  userId: string;
  /**
   * Opens one short RLS context per database step. The network calls below
   * happen BETWEEN those steps and never inside one — the shared conventions'
   * rule, and the reason this function takes a store rather than a `tx`.
   */
  store: TimeoffStore;
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
  const { userId, store } = input;

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
    // ── 1. READ (database) ───────────────────────────────────────────────────
    // Only rows for this year: a pending edit in another year belongs to that
    // year's pass, and Trek's toggle is scoped by the entries read for a year.
    const hoursPerDay = await hoursPerDayString();
    const { pending, typeIds } = await store.withEvents(userId, async (events, types) => {
      const seeded = await seedDefaultTypes(types, userId, hoursPerDay);
      return {
        pending: (await events.pending(userId)).filter((r) => r.date.startsWith(`${year}-`)),
        typeIds: new Map(seeded.map((type) => [type.code, type.id])),
      };
    });
    const stillPending = new Set<string>();

    // Dates that no longer have anything to send: Trek accepted the toggle, or
    // never needed one. Cleared together below so a pushed edit does not stay
    // flagged and get re-sent on every later pass.
    //
    // A staged upsert for a type Trek cannot hold AND has never had an entry
    // for starts here rather than at Trek: R7-2 keeps it out of the push, so
    // nothing upstream will ever settle it, and leaving it flagged would mean
    // a `*` in the UI forever. A CONVERTED day is the opposite case — Trek
    // still has its entry, `planPush` sends a removal for it, and it settles
    // through `applied` like any other push.
    const unpushable = unpushableUpserts(pending);
    const settled: string[] = [...unpushable.localOnly];
    const conversions = new Set(unpushable.converted);

    if (pending.length > 0) {
      // ── 2. PUSH (network — no transaction open) ────────────────────────────
      const push = planPush(pending);
      const applied = (push.desired.length > 0 || push.removals.length > 0)
        ? await applyDesiredState({ year, desired: push.desired, removals: push.removals }, opts)
        : { results: [], unchanged: [], alreadyAbsent: [] };

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
    }

    // ── 3. SETTLE (database) ─────────────────────────────────────────────────
    // A settled conversion loses its `provider_links` row: Trek no longer has
    // an entry for that date, so a link claiming otherwise would make
    // `removeEvent` stage a delete for something already gone.
    const settledConversions = settled.filter((date) => conversions.has(date));
    if (settled.length > 0 || result.weekendBlocked.length > 0) {
      await store.withEvents(userId, async (events) => {
        if (settled.length > 0) await events.clearPending(userId, settled, now);
        if (settledConversions.length > 0) {
          await events.unlinkProvider(userId, settledConversions, now);
        }
        if (result.weekendBlocked.length > 0) {
          await events.deleteDates(userId, result.weekendBlocked);
        }
      });
    }

    result.stillPending = [...stillPending];

    // ── 4. PULL (network — no transaction open) ──────────────────────────────
    const remote = await getEntries(year, opts);

    // ── 5. WRITE (database) ──────────────────────────────────────────────────
    const pull = await store.withEvents(userId, async (events) => {
      // `trekEvents` is what keeps a permits day alive: Trek is authoritative
      // for the existence of days it can hold, and only for those.
      const local = trekEvents(await events.inRange(userId, `${year}-01-01`, `${year}-12-31`));
      const plan = planPull(local, remote, stillPending);
      await events.upsertFromProvider(
        userId,
        plan.upserts.flatMap((u) => {
          const typeId = typeIds.get(typeCodeOf(u.kind));
          // Unreachable with the seeded catalogue; skipping rather than
          // throwing keeps one unmapped kind from failing the whole pass.
          return typeId === undefined ? [] : [{
            date: u.date,
            fraction: storedFraction(u.fraction),
            typeId,
            trekEntryId: u.trekEntryId,
            note: u.note,
          }];
        }),
        now,
      );
      await events.deleteDates(userId, plan.deletes);
      return plan;
    });
    result.pulled = pull.upserts.length;
    result.deleted = pull.deletes.length;

    // ── 6. STATS (deliberate, once — network) ────────────────────────────────
    if (input.withStats !== false) {
      result.stats = await getStats(year, opts);
      // Cached so the workspace can show Trek's figures without re-triggering
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
