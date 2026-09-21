import { accountAlertsJob, accountsSnapshotJob } from "@/modules/accounts/jobs";
import { cometaSweepJob, fundsDepositsJob } from "@/modules/funds/jobs";
import { documentsRetentionJob } from "@/modules/imports/jobs";
import { interestsAccrualJob } from "@/modules/interests/jobs";
import { payslipsSweepJob } from "@/modules/payroll/jobs";
import { pocketsAccrualJob } from "@/modules/pockets/jobs";
import { subscriptionsCheckJob } from "@/modules/subscriptions/jobs";
import { trekSyncJob } from "@/modules/timeoff/jobs";
import { walletSyncJob } from "@/modules/transactions/jobs";
import { backupJob } from "@/platform/backup/jobs";
import { exportAllJob } from "@/platform/export/jobs";
import { holidaysRefreshJob } from "@/platform/holidays/jobs";
import { monthlySummaryJob } from "@/platform/reports/jobs";
import { housekeepingJob } from "./housekeeping";
import type { JobDetail } from "./schema";

/**
 * When a job runs. `manual` is the odd one out: no tick ever asks for that tier, so such a job only
 * ever runs because an admin pressed "Run now" (spec §10.3). It is a tier and not a flag because
 * `job_runs.tier` has to record what asked for the run, and "nobody asked, a person did" is the
 * honest answer for those.
 */
export type Tier = "hourly" | "daily" | "monthly" | "manual";

/** The tiers the cron sidecar may ask for. */
export type ScheduledTier = Exclude<Tier, "manual">;

export interface JobDefinition {
  name: string;
  tier: Tier;
  run(): Promise<JobDetail>;
}

/** The one list of scheduled jobs. Each phase appends its jobs here. */
export const JOBS: readonly JobDefinition[] = [
  housekeepingJob,
  accountAlertsJob,
  accountsSnapshotJob,
  walletSyncJob,
  // After `wallet-sync`: `runTier` runs a tier in this order, so the check sees the new movements.
  subscriptionsCheckJob,
  // Hourly too, each rule at its own hour (spec §7.6): after `wallet-sync`, so the day it accrues
  // is worked out on the balances that sync has just brought in.
  interestsAccrualJob,
  fundsDepositsJob,
  pocketsAccrualJob,
  documentsRetentionJob,
  payslipsSweepJob,
  cometaSweepJob,
  // The leave calendar (spec §9.2): its own provider, its own lock, and no mail of its own.
  trekSyncJob,
  // The subscribed holiday calendars, kept current from their sources (M3).
  holidaysRefreshJob,
  // Every day with the rest of the daily tier (spec §10.2); its retention is in `housekeeping`.
  backupJob,
  // Last of the monthly tier: it reports numbers `accounts-snapshot` and `pockets-accrual` have
  // just settled, and `runTier` runs a tier in this order (spec §10.2).
  monthlySummaryJob,
  // No tier asks for this one: it runs when an admin presses "Export all data" (spec §10.3).
  exportAllJob,
];
