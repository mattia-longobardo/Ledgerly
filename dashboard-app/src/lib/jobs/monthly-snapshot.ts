/**
 * Monthly balance snapshot — PLAN §5 "Partial failure — strict phase ordering".
 *
 *   1. Read ING + Revolut from Wallet. Any required account missing → the whole
 *      read fails and nothing is written anywhere.
 *   2. Persist to Postgres as `pending_teable` (the idempotency authority:
 *      Teable has no unique constraints) plus the `balance_snapshots` read cache.
 *   3. Upsert the Teable row (PATCH the month's existing row, POST only when
 *      there is none), store `teable_record_id`, mark `done`.
 *
 * The phases are ordered so a crash between any two of them is recoverable
 * without a second Wallet read: once a `monthly_snapshots` row exists, its
 * 23:59 values are the only truth this job will ever write to Teable. Re-reading
 * Wallet on a retry would silently substitute balances from a different moment.
 */

import { errorMessage } from "@/lib/clients/http";
import { alertJobFailure, alertSuccessAfterRetry } from "@/lib/clients/gotify";
import { upsertAllocationRow, type AllocationWriteResult } from "@/lib/clients/teable";
import { getBalances } from "@/lib/clients/wallet";
import { REVOLUT_COMPONENT_KEYS } from "@/lib/clients/wallet-accounts";
import type { JobResult } from "@/lib/contracts";
import {
  attemptsFor,
  finishRun,
  getMonthlySnapshot,
  markSnapshotDone,
  markSnapshotStatus,
  persistPending,
  startRun,
  withJobLock,
} from "@/lib/repo/jobs";
import { recordSnapshots } from "@/lib/repo/balances";
import { monthKey as currentMonthKey } from "@/lib/time";

export const JOB_NAME = "monthly_snapshot" as const;

/**
 * PLAN §5: "after 5 in-route + 3 sweep attempts → poisoned". `attemptsFor()`
 * counts failed runs per month regardless of trigger, so the two budgets are
 * kept as one 8-failure budget for the month — the number of retries the plan
 * allows before auto-retrying stops.
 */
export const IN_ROUTE_ATTEMPTS = 5;
export const SWEEP_ATTEMPTS = 3;
export const MAX_ATTEMPTS = IN_ROUTE_ATTEMPTS + SWEEP_ATTEMPTS;

export type SnapshotTrigger = "cron" | "sweep" | "manual";

export interface RunMonthlySnapshotInput {
  /** Defaults to the current Europe/Rome month key. */
  monthKey?: string;
  trigger: SnapshotTrigger;
  now?: Date;
  /**
   * Manual override: the only thing that revives a `poisoned` or `missed`
   * month. Never set from cron or the sweep — that is what "auto-retries stop"
   * means.
   */
  force?: boolean;
}

/** Lock key: per month, so two different months never block each other. */
export function snapshotLockKey(monthKey: string): string {
  return `${JOB_NAME}:${monthKey}`;
}

/** pg numeric is a string end-to-end; this is the only float → string crossing. */
function toAmount(value: number): string {
  return value.toFixed(2);
}

interface Outcome {
  status: JobResult["status"];
  detail: Record<string, unknown>;
  error?: string;
}

interface Phase3Input {
  monthKey: string;
  ing: string;
  revolut: string;
}

/**
 * Phase 3 in isolation: the only phase a retry is ever allowed to repeat.
 *
 * Safe to repeat precisely because the Teable write is an upsert keyed on the
 * month — a second run PATCHes the row the first one wrote instead of appending
 * a twin. The id it hands back is the row that now holds the month, whether it
 * was created just now or has been there since before this app existed; either
 * way it is a valid `teable_record_id`.
 */
async function writeAndComplete(input: Phase3Input): Promise<AllocationWriteResult> {
  const result = await upsertAllocationRow({
    date: input.monthKey,
    // Teable's API is numeric; the strings above stay authoritative in Postgres.
    ing: Number(input.ing),
    revolut: Number(input.revolut),
  });
  await markSnapshotDone(input.monthKey, result.recordId);
  return result;
}

async function execute(
  monthKey: string,
  now: Date,
  force: boolean,
): Promise<Outcome> {
  const existing = await getMonthlySnapshot(monthKey);

  if (existing?.status === "done") {
    return {
      status: "already_done",
      detail: { monthKey, reason: "snapshot_already_done", teableRecordId: existing.teableRecordId },
    };
  }

  // Terminal states are terminal on purpose: no API hammering, no alert
  // fatigue. Only an explicit manual action revives them.
  if ((existing?.status === "poisoned" || existing?.status === "missed") && !force) {
    return {
      status: existing.status,
      detail: { monthKey, reason: `snapshot_${existing.status}`, requiresManualAction: true },
    };
  }

  let ing: string;
  let revolut: string;
  let reusedCachedValues: boolean;

  if (existing) {
    // A row exists ⇒ phases 1 and 2 already succeeded. Re-attempt ONLY the
    // write, from the cached 23:59 values.
    ing = existing.ing;
    revolut = existing.revolut;
    reusedCachedValues = true;
  } else {
    // Phase 1 — all-or-nothing; getBalances() throws rather than return partial.
    const balances = await getBalances();
    ing = toAmount(balances.ing);
    revolut = toAmount(balances.revolut);

    // Phase 2 — Postgres first, so a Teable failure can never lose the values.
    await persistPending({ monthKey, ing, revolut, capturedAt: now });
    await recordSnapshots([
      { source: "wallet", accountKey: "ing", balance: ing, capturedAt: now },
      { source: "wallet", accountKey: "revolut_total", balance: revolut, capturedAt: now },
      // The sub-accounts too: the Home account strip expands Revolut into them.
      ...REVOLUT_COMPONENT_KEYS.map((key) => ({
        source: "wallet" as const,
        accountKey: key,
        balance: toAmount(balances.breakdown[key]),
        capturedAt: now,
      })),
    ]);
    reusedCachedValues = false;
  }

  // Phase 3.
  const write = await writeAndComplete({ monthKey, ing, revolut });
  return {
    status: "success",
    detail: {
      monthKey,
      ing,
      revolut,
      teableRecordId: write.recordId,
      // "created" vs "updated" is the whole point of the upsert: the run log has
      // to say which one happened, or a month quietly growing a second row
      // would look identical to a clean first write.
      teableAction: write.action,
      // Surfaced, never acted on. The table held two 2026-09 rows on
      // 2026-09-01 and the owner merged them by hand: deciding which of two
      // rows to drop is a judgement about hand-entered data, so the job reports
      // and moves on rather than deleting anything.
      ...(write.duplicates ? { teableDuplicateRecordIds: write.duplicates } : {}),
      reusedCachedValues,
    },
  };
}

/**
 * Runs the snapshot for one month. Never throws: every path ends in a
 * `job_runs` row and a `JobResult`, including the no-op ones.
 */
export async function runMonthlySnapshot(input: RunMonthlySnapshotInput): Promise<JobResult> {
  const now = input.now ?? new Date();
  const monthKey = input.monthKey ?? currentMonthKey(now);
  const force = input.force ?? false;

  const priorFailures = await attemptsFor(JOB_NAME, monthKey);
  const run = await startRun({
    jobName: JOB_NAME,
    trigger: input.trigger,
    dedupeKey: monthKey,
    attempt: priorFailures + 1,
  });

  try {
    const outcome = await withJobLock(snapshotLockKey(monthKey), () =>
      execute(monthKey, now, force),
    );

    // Lock not acquired: a concurrent invocation owns this month. A curl
    // --retry after a timeout lands here, and must not be an error.
    if (outcome === null) {
      const detail = { monthKey, reason: "lock_not_acquired" };
      await finishRun(run.id, "already_done", { detail });
      return { job: JOB_NAME, status: "already_done", detail };
    }

    if (outcome.status === "success" && priorFailures > 0) {
      const attempts = priorFailures + 1;
      await finishRun(run.id, "success_after_retry", {
        detail: { ...outcome.detail, attempts },
      });
      await alertSuccessAfterRetry({
        job: JOB_NAME,
        attempts,
        monthKey,
        detail: outcome.detail.reusedCachedValues
          ? "Teable write replayed from the cached snapshot values."
          : undefined,
      });
      return { job: JOB_NAME, status: "success_after_retry", detail: { ...outcome.detail, attempts } };
    }

    await finishRun(run.id, outcome.status, { detail: outcome.detail });
    return { job: JOB_NAME, status: outcome.status, detail: outcome.detail };
  } catch (err) {
    const message = errorMessage(err);
    const failures = priorFailures + 1;
    const exhausted = failures >= MAX_ATTEMPTS;

    if (exhausted) {
      // Poisoning is the last write this month gets automatically. The alert
      // fires exactly here — once, on the final failure, with the month key.
      await markSnapshotStatus(monthKey, "poisoned");
      await finishRun(run.id, "poisoned", {
        error: message,
        detail: { monthKey, attempts: failures, requiresManualAction: true },
      });
      await alertJobFailure({ job: JOB_NAME, error: message, monthKey, attempts: failures });
      return {
        job: JOB_NAME,
        status: "poisoned",
        error: message,
        detail: { monthKey, attempts: failures, requiresManualAction: true },
      };
    }

    // Retries remain: stay quiet, the sweep picks it up within the hour.
    await finishRun(run.id, "failed", {
      error: message,
      detail: { monthKey, attempts: failures, remaining: MAX_ATTEMPTS - failures },
    });
    return {
      job: JOB_NAME,
      status: "failed",
      error: message,
      detail: { monthKey, attempts: failures, remaining: MAX_ATTEMPTS - failures },
    };
  }
}
