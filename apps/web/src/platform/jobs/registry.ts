import { accountAlertsJob, accountsSnapshotJob } from "@/modules/accounts/jobs";
import { budgetAlertsJob } from "@/modules/budgets/jobs";
import { fundsDepositsJob } from "@/modules/funds/jobs";
import { documentsRetentionJob } from "@/modules/imports/jobs";
import { interestsAccrualJob, interestsRematchJob } from "@/modules/interests/jobs";
import { pocketsAccrualJob, pocketsPlannedCleanupJob } from "@/modules/pockets/jobs";
import { subscriptionsCheckJob } from "@/modules/subscriptions/jobs";
import { recurrencesRefreshJob } from "@/modules/transactions/jobs";
import { backupJob } from "@/platform/backup/jobs";
import { exportAllJob } from "@/platform/export/jobs";
import { fxRatesRefreshJob } from "@/platform/fx/jobs";
import { holidaysRefreshJob } from "@/platform/holidays/jobs";
import { integrationsSyncJob } from "@/platform/integrations/jobs";
import { monthlySummaryJob } from "@/platform/reports/jobs";
import { documentsSweepJob } from "./documents-sweep";
import { housekeepingJob } from "./housekeeping";
import type { JobDetail } from "@ledgerly/domain/platform/jobs";

/**
 * When a job runs. `manual` is the odd one out: the scheduler never starts that tier, so such a job only
 * ever runs because an admin pressed "Run now" (spec §10.3). It is a tier and not a flag because
 * `job_runs.tier` has to record what asked for the run, and "nobody asked, a person did" is the
 * honest answer for those. `afterSync` has no tick either: `runAfterSync` starts such a job when a
 * sync has changed the movements (docs/scheduler.md).
 */
export type Tier = "minute" | "hourly" | "daily" | "monthly" | "manual" | "afterSync";

/** The tiers the worker's scheduler starts. */
export const SCHEDULED_TIERS = ["minute", "hourly", "daily", "monthly"] as const;
export type ScheduledTier = (typeof SCHEDULED_TIERS)[number];

/** What `job_runs.tier` says: who asked for the run. `afterSync` names a schedule, not an asker. */
export type RecordedTier = Exclude<Tier, "afterSync">;

export interface JobDefinition {
  name: string;
  tier: Tier;
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
  return job.tier === tier;
}

/**
 * When the worker's scheduler starts each tier, on the wall clock of {@link SCHEDULE_TIME_ZONE}
 * (spec §10.2): a field left out is every value, as `*` in cron. The same instants `cron/crontab`
 * gave until the worker (rewrite plan R1).
 */
export const SCHEDULE: Record<ScheduledTier, { minute?: number; hour?: number; dayOfMonth?: number }> = {
  // Every minute: the connections due by their owner's schedule (docs/scheduler.md).
  minute: {},
  // What goes by the date or by a stuck document, not by the movements.
  hourly: { minute: 30 },
  daily: { hour: 12, minute: 0 },
  monthly: { dayOfMonth: 1, hour: 0, minute: 5 },
};

export const SCHEDULE_TIME_ZONE = "Europe/Rome";

/** The one list of scheduled jobs. Each phase appends its jobs here. */
export const JOBS: readonly JobDefinition[] = [
  // First of all (docs/scheduler.md): every connection due by its own schedule, every minute. What
  // reads its result runs after it, through `runAfterSync`.
  integrationsSyncJob,
  housekeepingJob,
  accountAlertsJob,
  accountsSnapshotJob,
  // After a sync that changed the movements: own transfers and recurrences.
  recurrencesRefreshJob,
  // After such a sync too, and daily: a period that ends with no payment changes state by the date.
  subscriptionsCheckJob,
  // After such a sync: a budget emails right after the movement that passed a threshold (spec §7.3).
  budgetAlertsJob,
  // Hourly, each rule at its own hour (spec §7.6): by the date, and it syncs its own balance first.
  interestsAccrualJob,
  // Daily: a second look, lookup only, for the settlements whose posting was left unsure.
  interestsRematchJob,
  fundsDepositsJob,
  pocketsAccrualJob,
  pocketsPlannedCleanupJob,
  documentsRetentionJob,
  documentsSweepJob,
  // The subscribed holiday calendars, kept current from their sources (M3).
  holidaysRefreshJob,
  // The ECB exchange rates of the day, and on its first run the history (investments.md §1.8).
  fxRatesRefreshJob,
  // Every day with the rest of the daily tier (spec §10.2); its retention is in `housekeeping`.
  backupJob,
  // Last of the monthly tier: it reports numbers `accounts-snapshot` has
  // just settled, and `runTier` runs a tier in this order (spec §10.2).
  monthlySummaryJob,
  // No tier asks for this one: it runs when an admin presses "Export all data" (spec §10.3).
  exportAllJob,
];
