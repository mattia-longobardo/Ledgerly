/**
 * Daily Wallet account sync, now a thin wrapper over the integration engine:
 * the reconciliation, the credential and the run recording all live there, and
 * this file owns only the `job_runs` row, the advisory lock and the alert.
 *
 * It still syncs exactly one user — the owner — because the schedule is
 * process-wide and there is no per-user cron. Per-user schedules arrive with
 * `sync_jobs` becoming dispatchable in a later phase.
 *
 * The provider fetch happens inside `runSyncForUser`, in its own short-lived
 * pool connection, before `runSyncForUser` opens a second one for the apply
 * phase — never nested inside the one `withJobLock` here holds for the
 * `job_runs` bookkeeping and the advisory lock. The benefit over the Phase 1
 * shape is a single held pool connection during the sync's round trip instead
 * of two: this job's own transaction is only ever open for the bookkeeping,
 * not for the length of the Wallet conversation.
 */

import { alertJobFailure } from "@/lib/clients/gotify";
import { errorMessage } from "@/lib/clients/http";
import type { JobResult } from "@/lib/contracts";
import { db } from "@/lib/db";
import { finishRun, startRun, withJobLock } from "@/lib/repo/jobs";
import { ensureProvidersRegistered } from "@/platform/integrations/register-all";
import { runSyncForUser } from "@/modules/integrations/application/run-sync";
import { integrationDeps } from "@/modules/integrations/infrastructure/deps";
import { openOwnerConnection } from "@/modules/integrations/infrastructure/owner-connection";

export const JOB_NAME = "wallet_accounts_sync" as const;

/** One instance at a time: the crontab entry uses `curl --retry`. */
export const LOCK_KEY = JOB_NAME;

export interface RunWalletAccountsSyncInput {
  trigger?: "cron" | "manual";
}

async function syncOwner(userId: string): Promise<Record<string, unknown>> {
  const run = await runSyncForUser(integrationDeps(db))(userId, {
    provider: "wallet",
    kind: "accounts",
    trigger: "cron",
  });
  if (run.status === "failed") throw new Error(run.error ?? "wallet accounts sync failed");
  return { runId: run.id, status: run.status, ...run.stats };
}

/** Never throws. Every path ends in a `job_runs` row and a `JobResult`. */
export async function runWalletAccountsSync(input: RunWalletAccountsSyncInput = {}): Promise<JobResult> {
  ensureProvidersRegistered();
  const run = await startRun({ jobName: JOB_NAME, trigger: input.trigger ?? "cron" });

  try {
    // No owner, no connection, an unusable connection and a missing credential
    // are all the same answer: nothing to sync. A configuration state, not a
    // failure — recorded so the run log explains the silence, never alerted on.
    const owner = await openOwnerConnection("wallet");
    if (!owner) {
      const skipped = { reason: "wallet_not_connected" };
      await finishRun(run.id, "already_done", { detail: skipped });
      return { job: JOB_NAME, status: "already_done", detail: skipped };
    }

    const detail = await withJobLock(LOCK_KEY, () => syncOwner(owner.userId));

    // Lock not acquired: a concurrent invocation owns the sync. A `curl
    // --retry` after a timeout lands here, and must not read as an error.
    if (detail === null) {
      const skipped = { reason: "lock_not_acquired" };
      await finishRun(run.id, "already_done", { detail: skipped });
      return { job: JOB_NAME, status: "already_done", detail: skipped };
    }

    await finishRun(run.id, "success", { detail });
    return { job: JOB_NAME, status: "success", detail };
  } catch (err) {
    const error = errorMessage(err);
    await finishRun(run.id, "failed", { error });
    await alertJobFailure({ job: JOB_NAME, error });
    return { job: JOB_NAME, status: "failed", error };
  }
}
