/**
 * The scheduled wrapper around the Trek leave sync, running through the
 * integration engine.
 *
 * This file keeps only what makes the sync a first-class job: the `job_runs`
 * row and the status mapping. Everything about *how* the sync works — the
 * MCP conversation, the advisory lock, the read-diff-toggle pass — lives
 * behind `trekProvider.syncs.leave`, which `runSyncForUser` drives.
 *
 * Two policy choices worth stating, both inherited from the hourly sweep:
 *
 *  - A `partial` pass — the pull succeeded but some pushes did not — is
 *    recorded as `failed`, exactly as the sweep records a failed step. It is a
 *    real problem: an edit made in the dashboard has not reached Trek.
 *    Recording it as success would let the last-success badge stay green
 *    while the two calendars silently drift apart.
 *  - It does NOT alert. At an hourly cadence a flapping upstream would be pure
 *    Gotify noise; the settings page's staleness badge on the last success is
 *    the right signal for "this has been broken for a while". This is the
 *    opposite of the daily wallet refresh, which does alert precisely because
 *    there is no second attempt coming an hour later.
 *
 * When the owner has no Trek connection no `job_runs` row is written at all.
 * An hourly job logging "not connected" 24 times a day would push every other
 * job off the settings page's 20-row log, and "never ran" is the honest thing
 * for the badge to show until a connection exists.
 */

import type { JobResult } from "@/lib/contracts";
import { db } from "@/lib/db";
import { finishRun, startRun } from "@/lib/repo/jobs";
import { runSyncForUser } from "@/modules/integrations/application/run-sync";
import { integrationDeps } from "@/modules/integrations/infrastructure/deps";
import { openOwnerConnection } from "@/modules/integrations/infrastructure/owner-connection";
import { ensureProvidersRegistered } from "@/platform/integrations/register-all";

export const JOB_NAME = "trek_sync" as const;

// No LOCK_KEY here any more: the lock is taken inside `runTrekSync()` under
// `TREK_SYNC_LOCK_KEY`, so that every caller contends for it and not just this
// one. A key exported from here would suggest this file still owns it.

export interface RunTrekSyncJobInput {
  trigger?: "cron" | "manual";
}

/**
 * Never throws. Every path except the not-connected one ends in a `job_runs`
 * row and a `JobResult`.
 */
export async function runTrekSyncJob(input: RunTrekSyncJobInput = {}): Promise<JobResult> {
  const { trigger = "cron" } = input;
  ensureProvidersRegistered();

  // Checked before opening a run row, so an install with no Trek connection
  // writes nothing: an hourly job logging "not connected" 24 times a day would
  // push every other job off the Administration page's 20-row log.
  const owner = await openOwnerConnection("trek");
  if (!owner) {
    return { job: JOB_NAME, status: "already_done", detail: { reason: "not_connected" } };
  }

  const run = await startRun({ jobName: JOB_NAME, trigger });
  try {
    const syncRun = await runSyncForUser(integrationDeps(db))(owner.userId, {
      provider: "trek",
      kind: "leave",
      trigger: "cron",
    });
    if (syncRun.status === "failed") {
      const error = syncRun.error ?? "trek sync failed";
      await finishRun(run.id, "failed", { error, detail: syncRun.stats });
      return { job: JOB_NAME, status: "failed", error, detail: syncRun.stats };
    }
    // Reachable when a "Sync now" from the Work page is still in flight: the
    // engine hands back the run already going rather than starting a second
    // conversation with Trek, whose toggle is its own inverse.
    if (syncRun.status === "running") {
      const skipped = { reason: "already_running" };
      await finishRun(run.id, "already_done", { detail: skipped });
      return { job: JOB_NAME, status: "already_done", detail: skipped };
    }
    const detail = { runId: syncRun.id, ...syncRun.stats };
    await finishRun(run.id, "success", { detail });
    return { job: JOB_NAME, status: "success", detail };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await finishRun(run.id, "failed", { error });
    return { job: JOB_NAME, status: "failed", error };
  }
}
