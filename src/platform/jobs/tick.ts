import "server-only";
import { touchHeartbeat } from "./heartbeat";
import { withJobLock } from "./lock";
import { JOBS, type JobDefinition, runsIn, type ScheduledTier } from "./registry";
import { type Outcome, recordSkipped, runAndRecord } from "./run";

/**
 * Runs every job of a tier, one after the other. A job's failure never stops the next job, and
 * neither does a failure recording its own bookkeeping (the `running`, `success`/`failed`, or
 * `skipped` row): each job's run-row writes are isolated in their own try/catch. The heartbeat is
 * touched in a `finally` so it is always up to date, even when a job or its bookkeeping breaks —
 * the caller (the cron sidecar) must never see a failure that would make it retry the tier and
 * re-run jobs that already succeeded.
 */
export async function runTier(
  tier: ScheduledTier,
  jobs: readonly JobDefinition[] = JOBS,
): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  try {
    for (const job of jobs.filter((j) => runsIn(j, tier))) {
      if (job.hasWork && !(await job.hasWork())) continue;
      const locked = await withJobLock(`job:${job.name}`, () => runAndRecord(job, tier));
      if (locked.ran) {
        outcomes.push({ job: job.name, status: locked.value });
      } else {
        await recordSkipped(job, tier);
        outcomes.push({ job: job.name, status: "skipped" });
      }
    }
  } finally {
    await touchHeartbeat();
  }
  return outcomes;
}

/**
 * One job, because an admin asked for it (spec §10.3). The same lock and the same bookkeeping as a
 * tick, so a job already running is skipped rather than run twice — the run is recorded under the
 * tier `manual`, which is who asked rather than when.
 */
export async function runJobByHand(name: string): Promise<Outcome | null> {
  const job = JOBS.find((one) => one.name === name);
  if (!job) return null;
  try {
    const locked = await withJobLock(`job:${job.name}`, () => runAndRecord(job, "manual"));
    if (locked.ran) return { job: job.name, status: locked.value };
    await recordSkipped(job, "manual");
    return { job: job.name, status: "skipped" };
  } finally {
    await touchHeartbeat();
  }
}
