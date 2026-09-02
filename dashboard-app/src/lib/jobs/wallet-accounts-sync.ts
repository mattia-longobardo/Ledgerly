/**
 * Daily Wallet account sync.
 *
 * Sibling of `wallet-refresh`, and deliberately separate from it: the refresh
 * writes the two legacy balance snapshots the Home page still reads, while this
 * one reconciles the accounts module — which accounts exist, what they are
 * called, and one provider balance point per account per day.
 *
 * Like every daily job here it alerts on failure: a missed run is a full day of
 * stale accounts and there is no second attempt an hour later.
 *
 * The user loop uses the pool client directly because `users` carries no RLS —
 * it is an identity table, and the job needs to see everyone. Each user's sync
 * then runs inside `withUserContext`, so every account statement it makes is
 * scoped by the database itself and not merely by the predicates in the
 * repositories.
 */

import { eq } from "drizzle-orm";
import { alertJobFailure } from "@/lib/clients/gotify";
import { errorMessage } from "@/lib/clients/http";
import type { JobResult } from "@/lib/contracts";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { walletToken } from "@/lib/env";
import { finishRun, startRun, withJobLock } from "@/lib/repo/jobs";
import { syncProviderAccounts } from "@/modules/accounts/application/sync-provider-accounts";
import { DrizzleAccountsRepository } from "@/modules/accounts/infrastructure/drizzle-accounts-repository";
import { DrizzleProviderLinksRepository } from "@/modules/accounts/infrastructure/drizzle-provider-links-repository";
import { walletAccountsSource } from "@/modules/accounts/infrastructure/wallet-adapter";
import { recordAudit } from "@/platform/audit/record";
import { withUserContext } from "@/platform/db/context";

export const JOB_NAME = "wallet_accounts_sync" as const;

/** One instance at a time: the crontab entry uses `curl --retry`. */
export const LOCK_KEY = JOB_NAME;

export interface RunWalletAccountsSyncInput {
  trigger?: "cron" | "manual";
}

const clock = { now: () => new Date() };

/** `walletToken()` throws when the token file is missing or empty. */
function walletConfigured(): boolean {
  try {
    walletToken();
    return true;
  } catch {
    return false;
  }
}

async function syncEveryUser(): Promise<Record<string, unknown>> {
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.status, "active"));
  const totals = { users: 0, created: 0, updated: 0, adopted: 0, balances: 0, missing: 0 };

  for (const { id: userId } of rows) {
    const counts = await withUserContext(db, { userId, role: "system" }, (tx) =>
      syncProviderAccounts({
        accounts: new DrizzleAccountsRepository(tx),
        links: new DrizzleProviderLinksRepository(tx),
        clock,
        audit: (e) => recordAudit(tx, e),
        source: walletAccountsSource(clock),
      })(userId),
    );
    totals.users += 1;
    totals.created += counts.created;
    totals.updated += counts.updated;
    totals.adopted += counts.adopted;
    totals.balances += counts.balances;
    totals.missing += counts.missing;
  }

  return totals;
}

/**
 * Never throws. Every path ends in a `job_runs` row and a `JobResult`,
 * including the unconfigured one and the one where another invocation already
 * holds the lock.
 */
export async function runWalletAccountsSync(input: RunWalletAccountsSyncInput = {}): Promise<JobResult> {
  const run = await startRun({ jobName: JOB_NAME, trigger: input.trigger ?? "cron" });

  try {
    // No credential is a configuration state, not a failure: recorded so the
    // run log explains the silence, but never alerted on.
    if (!walletConfigured()) {
      const skipped = { reason: "wallet_not_configured" };
      await finishRun(run.id, "already_done", { detail: skipped });
      return { job: JOB_NAME, status: "already_done", detail: skipped };
    }

    const detail = await withJobLock(LOCK_KEY, syncEveryUser);

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
