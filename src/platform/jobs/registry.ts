import { accountAlertsJob, accountsSnapshotJob } from "@/modules/accounts/jobs";
import { fundsDepositsJob } from "@/modules/funds/jobs";
import { documentsRetentionJob } from "@/modules/imports/jobs";
import { interestsAccrualJob } from "@/modules/interests/jobs";
import { payslipsSweepJob } from "@/modules/payroll/jobs";
import { pocketsAccrualJob } from "@/modules/pockets/jobs";
import { subscriptionsCheckJob } from "@/modules/subscriptions/jobs";
import { walletSyncJob } from "@/modules/transactions/jobs";
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
  interestsAccrualJob,
  accountsSnapshotJob,
  walletSyncJob,
  // After `wallet-sync`: `runTier` runs a tier in this order, so the check sees the new movements.
  subscriptionsCheckJob,
  fundsDepositsJob,
  pocketsAccrualJob,
  documentsRetentionJob,
  payslipsSweepJob,
];
