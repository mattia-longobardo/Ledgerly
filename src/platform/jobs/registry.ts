import { accountAlertsJob, accountsSnapshotJob } from "@/modules/accounts/jobs";
import { budgetAlertsJob } from "@/modules/budgets/jobs";
import { cometaSweepJob, fundsDepositsJob } from "@/modules/funds/jobs";
import { documentsRetentionJob } from "@/modules/imports/jobs";
import { interestsAccrualJob, interestsRematchJob } from "@/modules/interests/jobs";
import { payslipsSweepJob } from "@/modules/payroll/jobs";
import { pocketsAccrualJob, pocketsPlannedCleanupJob } from "@/modules/pockets/jobs";
import { subscriptionsCheckJob } from "@/modules/subscriptions/jobs";
import { recurrencesRefreshJob } from "@/modules/transactions/jobs";
import { backupJob } from "@/platform/backup/jobs";
import { exportAllJob } from "@/platform/export/jobs";
import { fxRatesRefreshJob } from "@/platform/fx/jobs";
import { holidaysRefreshJob } from "@/platform/holidays/jobs";
import { integrationsSyncJob } from "@/platform/integrations/jobs";
import { monthlySummaryJob } from "@/platform/reports/jobs";
import { housekeepingJob } from "./housekeeping";
import type { JobDetail } from "./schema";

/**
 * When a job runs. `manual` is the odd one out: no tick ever asks for that tier, so such a job only
 * ever runs because an admin pressed "Run now" (spec §10.3). It is a tier and not a flag because
 * `job_runs.tier` has to record what asked for the run, and "nobody asked, a person did" is the
 * honest answer for those.
 */
export type Tier = "minute" | "hourly" | "daily" | "monthly" | "manual";

/** The tiers the cron sidecar may ask for. */
export type ScheduledTier = Exclude<Tier, "manual">;

export interface JobDefinition {
  name: string;
  tier: Tier;
  /** Further tiers that run the job too: `integrations-sync` is in `minute` and `hourly`. */
  alsoIn?: readonly ScheduledTier[];
  /**
   * Asked by a tick before the job runs: false means there is nothing to do, and the tick passes
   * the job by without a lock or a `job_runs` row. A job ticked every minute uses it, or
   * `job_runs` grows by 1,440 rows a day that say nothing. "Run now" does not ask.
   */
  hasWork?(): Promise<boolean>;
  run(): Promise<JobDetail>;
}

/** Whether a tick of `tier` runs this job. */
export function runsIn(job: JobDefinition, tier: Tier): boolean {
  return job.tier === tier || (job.alsoIn?.includes(tier as ScheduledTier) ?? false);
}

/** The one list of scheduled jobs. Each phase appends its jobs here. */
export const JOBS: readonly JobDefinition[] = [
  // First of all (docs/scheduler.md): every connection due by its own schedule, Wallet, Trek and
  // Paperless, every minute. In the hourly tier too, ahead of everything that reads its result.
  integrationsSyncJob,
  housekeepingJob,
  accountAlertsJob,
  accountsSnapshotJob,
  // What `wallet-sync` did besides the pass (own transfers, recurrences), still every hour.
  recurrencesRefreshJob,
  // After the sync: `runTier` runs a tier in this order, so the check sees the new movements.
  subscriptionsCheckJob,
  // Hourly, after `wallet-sync` too: a budget emails within the hour of the movement that passed
  // one of its thresholds (spec §7.3).
  budgetAlertsJob,
  // Hourly too, each rule at its own hour (spec §7.6): after `wallet-sync`, so the day it accrues
  // is worked out on the balances that sync has just brought in.
  interestsAccrualJob,
  // Daily: a second look, lookup only, for the settlements whose posting was left unsure.
  interestsRematchJob,
  fundsDepositsJob,
  pocketsAccrualJob,
  pocketsPlannedCleanupJob,
  documentsRetentionJob,
  payslipsSweepJob,
  cometaSweepJob,
  // The subscribed holiday calendars, kept current from their sources (M3).
  holidaysRefreshJob,
  // The ECB exchange rates of the day, and on its first run the history (investments.md §1.8).
  fxRatesRefreshJob,
  // Every day with the rest of the daily tier (spec §10.2); its retention is in `housekeeping`.
  backupJob,
  // Last of the monthly tier: it reports numbers `accounts-snapshot` and `pockets-accrual` have
  // just settled, and `runTier` runs a tier in this order (spec §10.2).
  monthlySummaryJob,
  // No tier asks for this one: it runs when an admin presses "Export all data" (spec §10.3).
  exportAllJob,
];
