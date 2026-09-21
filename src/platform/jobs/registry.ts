import { accountAlertsJob, accountsSnapshotJob } from "@/modules/accounts/jobs";
import { cometaSweepJob, fundsDepositsJob } from "@/modules/funds/jobs";
import { documentsRetentionJob } from "@/modules/imports/jobs";
import { interestsAccrualJob } from "@/modules/interests/jobs";
import { payslipsSweepJob } from "@/modules/payroll/jobs";
import { pocketsAccrualJob } from "@/modules/pockets/jobs";
import { subscriptionsCheckJob } from "@/modules/subscriptions/jobs";
import { trekSyncJob } from "@/modules/timeoff/jobs";
import { walletSyncJob } from "@/modules/transactions/jobs";
import { holidaysRefreshJob } from "@/platform/holidays/jobs";
import { housekeepingJob } from "./housekeeping";
import type { JobDetail } from "./schema";

export type Tier = "hourly" | "daily" | "monthly";

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
];
