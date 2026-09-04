/**
 * Hourly Wallet transactions sync — the mirror of `wallet-accounts-sync.ts`,
 * pinned to `kind: "transactions"` and the "hourly" tier that
 * `transactionsSync.schedule` (in `wallet-provider-adapter.ts`) declares.
 *
 * Task 8 added `transactions` as a `SyncKind` the engine understands, but
 * nothing dispatched it. This job is that trigger, on the existing hourly
 * cron tier — no new scheduling mechanism. The other half of the original gap
 * (a connection made before this phase has an `accounts` `sync_jobs` row and
 * no `transactions` one, so the cursor write was silently discarded) is fixed
 * generically in `run-sync.ts`'s own `prepare()`, which now `ensure()`s the
 * job row for whatever kind it resolves — every trigger benefits, not just
 * this one.
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

export const JOB_NAME = "wallet_transactions_sync" as const;

/** One instance at a time: the crontab entry uses `curl --retry`. */
export const LOCK_KEY = JOB_NAME;

export interface RunWalletTransactionsSyncInput {
  trigger?: "cron" | "manual";
}

async function syncOwner(userId: string): Promise<Record<string, unknown>> {
  const run = await runSyncForUser(integrationDeps(db))(userId, {
    provider: "wallet",
    kind: "transactions",
    trigger: "cron",
  });
  if (run.status === "failed") throw new Error(run.error ?? "wallet transactions sync failed");
  return { runId: run.id, status: run.status, ...run.stats };
}

/** Never throws. Every path ends in a `job_runs` row and a `JobResult`. */
export async function runWalletTransactionsSync(input: RunWalletTransactionsSyncInput = {}): Promise<JobResult> {
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
