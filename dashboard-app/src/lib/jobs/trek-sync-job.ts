/**
 * The scheduled wrapper around `runTrekSync()`.
 *
 * The sync itself is a plain function so the "Sync now" server action and the
 * cron entry can share one code path. This file adds only what makes it a
 * first-class job: the `job_runs` row and the status mapping — nothing about
 * *how* the sync works lives here, and neither does the advisory lock. The lock
 * moved into `runTrekSync()` because the dashboard's Save and Remove start a
 * pass too and never come through this file; guarding it here would have
 * serialised the cron entry against itself and left the UI free to race it.
 *
 * Two policy choices worth stating, both inherited from the hourly sweep:
 *
 *  - A `partial` pass — the pull succeeded but some pushes did not — is
 *    recorded as `failed` with the per-date errors joined, exactly as the sweep
 *    records a failed step. It is a real problem: an edit made in the dashboard
 *    has not reached Trek. Recording it as success would let the last-success
 *    badge stay green while the two calendars silently drift apart.
 *  - It does NOT alert. At an hourly cadence a flapping upstream would be pure
 *    Gotify noise; the settings page's staleness badge on the last success is
 *    the right signal for "this has been broken for a while". This is the
 *    opposite of the daily wallet refresh, which does alert precisely because
 *    there is no second attempt coming an hour later.
 *
 * When Trek is not configured no `job_runs` row is written at all. An hourly
 * job logging "not configured" 24 times a day would push every other job off
 * the settings page's 20-row log, and "never ran" is the honest thing for the
 * badge to show until a credential exists.
 */

import { trekConfigured } from "@/lib/clients/trek";
import type { JobResult } from "@/lib/contracts";
import { finishRun, startRun } from "@/lib/repo/jobs";
import { runTrekSync, type RunTrekSyncInput, type TrekSyncResult } from "./trek-sync";

export const JOB_NAME = "trek_sync" as const;

// No LOCK_KEY here any more: the lock is taken inside `runTrekSync()` under
// `TREK_SYNC_LOCK_KEY`, so that every caller contends for it and not just this
// one. A key exported from here would suggest this file still owns it.

export interface RunTrekSyncJobInput extends RunTrekSyncInput {
  trigger?: "cron" | "manual";
}

/** Everything the run log should keep, minus the noisy full arrays. */
export function summarize(result: TrekSyncResult): Record<string, unknown> {
  return {
    year: result.year,
    pulled: result.pulled,
    deleted: result.deleted,
    pushed: result.pushed,
    ...(result.weekendBlocked.length > 0 ? { weekendBlocked: result.weekendBlocked } : {}),
    ...(result.stillPending.length > 0 ? { stillPending: result.stillPending } : {}),
  };
}

/**
 * Never throws. Every path except the unconfigured one ends in a `job_runs`
 * row and a `JobResult`, including the one where another pass holds the lock.
 */
export async function runTrekSyncJob(input: RunTrekSyncJobInput = {}): Promise<JobResult> {
  const { trigger = "cron", ...syncInput } = input;

  // Checked before opening a run row, so an unconfigured install writes nothing.
  // Deliberately the config predicate rather than a trial sync: running the
  // sync to find out whether to run the sync would do the whole pass twice.
  if (!trekConfigured()) {
    return { job: JOB_NAME, status: "already_done", detail: { reason: "not_configured" } };
  }

  const run = await startRun({ jobName: JOB_NAME, trigger });

  try {
    const result = await runTrekSync(syncInput);

    // Lock not acquired: a concurrent pass owns the sync. A `curl --retry`
    // after a timeout lands here and must not read as an error.
    if (result.status === "skipped") {
      const skipped = { reason: "lock_not_acquired" };
      await finishRun(run.id, "already_done", { detail: skipped });
      return { job: JOB_NAME, status: "already_done", detail: skipped };
    }

    const detail = summarize(result);

    if (result.status === "failed" || result.status === "partial") {
      const error = result.errors.join("; ");
      await finishRun(run.id, "failed", { error, detail });
      return { job: JOB_NAME, status: "failed", error, detail };
    }

    await finishRun(run.id, "success", { detail });
    return { job: JOB_NAME, status: "success", detail };
  } catch (err) {
    // runTrekSync() catches its own errors, so reaching here means the lock or
    // the run bookkeeping itself failed. Record it and stay silent.
    const error = err instanceof Error ? err.message : String(err);
    await finishRun(run.id, "failed", { error });
    return { job: JOB_NAME, status: "failed", error };
  }
}
