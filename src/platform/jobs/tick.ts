import "server-only";
import { eq } from "drizzle-orm";
import { redactForLog } from "@/platform/auth/logger";
import { getDb } from "@/platform/db/client";
import { touchHeartbeat } from "./heartbeat";
import { withJobLock } from "./lock";
import { JOBS, type JobDefinition, type Tier } from "./registry";
import { jobRuns } from "./schema";

type Status = "success" | "failed" | "skipped";
type Outcome = { job: string; status: Status };

const MAX_ERROR_LENGTH = 2000;

/** Postgres text columns reject a NUL byte (22021); an error's message is untrusted text. */
function describeError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replaceAll("\u0000", "").slice(0, MAX_ERROR_LENGTH);
}

async function recordSkipped(job: JobDefinition, tier: Tier): Promise<void> {
  try {
    await getDb()
      .insert(jobRuns)
      .values({
        job: job.name,
        tier,
        status: "skipped",
        finishedAt: new Date(),
        detail: { reason: "already_running" },
      });
  } catch (error) {
    console.error("[jobs] failed to record a skipped run", redactForLog(error));
  }
}

async function runAndRecord(job: JobDefinition, tier: Tier): Promise<Status> {
  let runId: string | undefined;
  try {
    const [run] = await getDb()
      .insert(jobRuns)
      .values({ job: job.name, tier, status: "running" })
      .returning();
    runId = run.id;
  } catch (error) {
    console.error("[jobs] failed to record a running run", redactForLog(error));
  }
  try {
    const detail = await job.run();
    if (runId !== undefined) {
      try {
        await getDb()
          .update(jobRuns)
          .set({ status: "success", finishedAt: new Date(), detail })
          .where(eq(jobRuns.id, runId));
      } catch (error) {
        console.error("[jobs] failed to record a successful run", redactForLog(error));
      }
    }
    return "success";
  } catch (error) {
    if (runId !== undefined) {
      try {
        await getDb()
          .update(jobRuns)
          .set({ status: "failed", finishedAt: new Date(), error: describeError(error) })
          .where(eq(jobRuns.id, runId));
      } catch (updateError) {
        console.error("[jobs] failed to record a failed run", redactForLog(updateError));
      }
    }
    return "failed";
  }
}

/**
 * Runs every job of a tier, one after the other. A job's failure never stops the next job, and
 * neither does a failure recording its own bookkeeping (the `running`, `success`/`failed`, or
 * `skipped` row): each job's run-row writes are isolated in their own try/catch. The heartbeat is
 * touched in a `finally` so it is always up to date, even when a job or its bookkeeping breaks —
 * the caller (the cron sidecar) must never see a failure that would make it retry the tier and
 * re-run jobs that already succeeded.
 */
export async function runTier(tier: Tier, jobs: readonly JobDefinition[] = JOBS): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  try {
    for (const job of jobs.filter((j) => j.tier === tier)) {
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
