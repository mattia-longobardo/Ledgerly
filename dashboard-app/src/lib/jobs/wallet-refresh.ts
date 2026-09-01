/**
 * Daily Wallet refresh — 12:00 Europe/Rome.
 *
 * Wallet (BudgetBakers) syncs its own upstream banks at noon, so a figure read
 * at any other hour is the same figure read at noon. This used to be a step in
 * the hourly sweep gated on a 15-minute staleness budget, which meant 24 API
 * calls a day to learn the same number 23 times.
 *
 * Two consequences of moving it out that are easy to get wrong:
 *
 *  - There is no staleness gate here. The cron schedule IS the gate. A gate on
 *    top of a daily schedule can only ever suppress the one refresh of the day.
 *  - It does NOT touch the heartbeat. The heartbeat stays owned by the hourly
 *    sweep because the health endpoint's window is two hours; a daily job
 *    touching it would let a dead sweep look alive, and a daily job *failing* to
 *    touch it would look dead every day.
 *
 * Unlike the sweep — which stays deliberately silent, because alerting on an
 * hourly job's flapping upstream is pure noise — a once-daily job alerts on
 * failure. One missed run is a full day of stale balances and there is no
 * second attempt coming an hour later.
 */

import { errorMessage } from "@/lib/clients/http";
import { alertJobFailure } from "@/lib/clients/gotify";
import { getBalances } from "@/lib/clients/wallet";
import { REVOLUT_COMPONENT_KEYS } from "@/lib/clients/wallet-accounts";
import type { JobResult } from "@/lib/contracts";
import { recordSnapshots } from "@/lib/repo/balances";
import { finishRun, startRun, withJobLock } from "@/lib/repo/jobs";

export const JOB_NAME = "wallet_refresh" as const;

/** One instance at a time: the crontab entry uses `curl --retry`. */
export const LOCK_KEY = JOB_NAME;

export interface RunWalletRefreshInput {
  trigger?: "cron" | "manual";
  now?: Date;
}

/** pg numeric is a string end-to-end; this is the only float → string crossing. */
function toAmount(value: number): string {
  return value.toFixed(2);
}

async function refresh(now: Date): Promise<Record<string, unknown>> {
  // All-or-nothing by design (§5 phase 1): getBalances() throws rather than
  // return a partial read, so a renamed account can never become a half-written
  // cache the dashboard then displays as fact.
  const balances = await getBalances();
  await recordSnapshots([
    { source: "wallet", accountKey: "ing", balance: toAmount(balances.ing), capturedAt: now },
    {
      source: "wallet",
      accountKey: "revolut_total",
      balance: toAmount(balances.revolut),
      capturedAt: now,
    },
    // The sub-accounts too: the Home account strip expands Revolut into them.
    ...REVOLUT_COMPONENT_KEYS.map((key) => ({
      source: "wallet" as const,
      accountKey: key,
      balance: toAmount(balances.breakdown[key]),
      capturedAt: now,
    })),
  ]);

  return {
    ing: toAmount(balances.ing),
    revolut: toAmount(balances.revolut),
    accounts: 2 + REVOLUT_COMPONENT_KEYS.length,
  };
}

/**
 * Never throws. Every path ends in a `job_runs` row and a `JobResult`,
 * including the one where another invocation already holds the lock.
 */
export async function runWalletRefresh(input: RunWalletRefreshInput = {}): Promise<JobResult> {
  const now = input.now ?? new Date();
  const run = await startRun({ jobName: JOB_NAME, trigger: input.trigger ?? "cron" });

  try {
    const detail = await withJobLock(LOCK_KEY, () => refresh(now));

    // Lock not acquired: a concurrent invocation owns the refresh. A `curl
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
