import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/platform/db/client";
import { touchHeartbeat } from "./heartbeat";
import { withJobLock } from "./lock";
import { JOBS, type JobDefinition, type Tier } from "./registry";
import { jobRuns } from "./schema";

type Outcome = { job: string; status: "success" | "failed" | "skipped" };

function describeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000);
}

/** Runs every job of a tier, one after the other; one failure never stops the others. */
export async function runTier(tier: Tier, jobs: readonly JobDefinition[] = JOBS): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  for (const job of jobs.filter((j) => j.tier === tier)) {
    const locked = await withJobLock(`job:${job.name}`, async () => {
      const [run] = await getDb()
        .insert(jobRuns)
        .values({ job: job.name, tier, status: "running" })
        .returning();
      try {
        const detail = await job.run();
        await getDb()
          .update(jobRuns)
          .set({ status: "success", finishedAt: new Date(), detail })
          .where(eq(jobRuns.id, run.id));
        return "success" as const;
      } catch (error) {
        await getDb()
          .update(jobRuns)
          .set({ status: "failed", finishedAt: new Date(), error: describeError(error) })
          .where(eq(jobRuns.id, run.id));
        return "failed" as const;
      }
    });
    if (!locked.ran) {
      await getDb()
        .insert(jobRuns)
        .values({
          job: job.name,
          tier,
          status: "skipped",
          finishedAt: new Date(),
          detail: { reason: "already_running" },
        });
    }
    outcomes.push({ job: job.name, status: locked.ran ? locked.value : "skipped" });
  }
  await touchHeartbeat();
  return outcomes;
}
