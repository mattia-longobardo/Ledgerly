/**
 * The jobs that read the movements, run right after a sync that changed them (docs/scheduler.md).
 *
 * A job is behind when a sync changed the movements after the job last started and succeeded. That
 * one comparison, read from `sync_runs` and `job_runs`, covers every case with no state of its own:
 * a sync with no change starts nothing, two syncs in a row start a job once it is behind again, and
 * a job that failed, was skipped or died in a restart is still behind at the next sync, whatever
 * that sync brings.
 */
import "server-only";
import { budgetAlertsJob } from "@/modules/budgets/jobs";
import { fundsDepositsJob } from "@/modules/funds/jobs";
import { subscriptionsCheckJob } from "@/modules/subscriptions/jobs";
import { recurrencesRefreshJob } from "@/modules/transactions/jobs";
import { redactForLog } from "@/platform/auth/logger";
import { lastMovementChangeAt } from "@/platform/integrations/service";
import { and, eq, inArray, max } from "drizzle-orm";
import { getDb } from "@/platform/db/client";
import { withJobLock } from "./lock";
import type { JobDefinition, RecordedTier } from "./registry";
import { type Outcome, recordSkipped, runAndRecord } from "./run";
import { jobRuns } from "./schema";

/** In this order: own transfers and recurrences first, as the others read the result. */
export const AFTER_SYNC_JOBS: readonly JobDefinition[] = [
  recurrencesRefreshJob,
  subscriptionsCheckJob,
  budgetAlertsJob,
  fundsDepositsJob,
];

/** How long a job in use by another run is waited for, and how often it is tried again. */
const BUSY_WAIT_MS = 60_000;
const BUSY_POLL_MS = 2_000;

export interface AfterSyncOptions {
  jobs?: readonly JobDefinition[];
  /** Injected in tests so the wait for a job in use is not actually waited through. */
  sleep?: (ms: number) => Promise<void>;
  busyWaitMs?: number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

async function jobsBehind(jobs: readonly JobDefinition[]): Promise<JobDefinition[]> {
  const changedAt = await lastMovementChangeAt();
  if (changedAt === null || jobs.length === 0) return [];
  const rows = await getDb()
    .select({ job: jobRuns.job, at: max(jobRuns.startedAt) })
    .from(jobRuns)
    .where(
      and(
        inArray(
          jobRuns.job,
          jobs.map((job) => job.name),
        ),
        eq(jobRuns.status, "success"),
      ),
    )
    .groupBy(jobRuns.job);
  const lastSuccess = new Map(rows.map((row) => [row.job, row.at]));
  return jobs.filter((job) => {
    const at = lastSuccess.get(job.name);
    return !at || at <= changedAt;
  });
}

/**
 * `forEachUser` keeps one user's failure from the others and reports it as a count, so such a job
 * returns normally. Here that has to be a failure: `job_runs` says so and the job stays behind.
 */
function failingOnAnyUser(job: JobDefinition): JobDefinition {
  return {
    ...job,
    async run() {
      const detail = await job.run();
      const failed = Number(detail.failed ?? 0);
      if (failed > 0) throw new Error(`${job.name} failed for ${failed} user(s); the log has the cause`);
      return detail;
    },
  };
}

/**
 * Runs the jobs that are behind, one after the other. A job in use by another run is waited for,
 * because that run can have started before the last sync ended; after the wait it counts only if it
 * is still behind. Never throws: this follows a sync that has succeeded, and a check that fails
 * leaves its own `job_runs` row and does not change that.
 */
export async function runAfterSync(tier: RecordedTier, options: AfterSyncOptions = {}): Promise<Outcome[]> {
  const sleep = options.sleep ?? defaultSleep;
  const deadline = Date.now() + (options.busyWaitMs ?? BUSY_WAIT_MS);
  const outcomes: Outcome[] = [];
  try {
    let waiting = await jobsBehind(options.jobs ?? AFTER_SYNC_JOBS);
    while (waiting.length > 0) {
      const busy: JobDefinition[] = [];
      for (const job of waiting) {
        const locked = await withJobLock(`job:${job.name}`, () => runAndRecord(failingOnAnyUser(job), tier));
        if (locked.ran) outcomes.push({ job: job.name, status: locked.value });
        else busy.push(job);
      }
      if (busy.length === 0) break;
      if (Date.now() >= deadline) {
        for (const job of busy) {
          await recordSkipped(job, tier);
          outcomes.push({ job: job.name, status: "skipped" });
        }
        break;
      }
      await sleep(BUSY_POLL_MS);
      waiting = await jobsBehind(busy);
    }
  } catch (error) {
    console.error("[jobs] the checks after a sync could not run", redactForLog(error));
  }
  return outcomes;
}
