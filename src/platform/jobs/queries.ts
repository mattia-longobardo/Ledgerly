import "server-only";
import { desc, sql } from "drizzle-orm";
import type { Ctx } from "@/platform/context";
import { getDb } from "@/platform/db/client";
import { JOBS, type Tier } from "./registry";
import { jobRuns } from "./schema";

/** The jobs card of Settings › Integrations (spec §7.10, §10.3): admins only. */
export interface JobStatus {
  name: string;
  tier: Tier;
  lastRun: {
    startedAt: Date;
    finishedAt: Date | null;
    status: "running" | "success" | "failed" | "skipped";
    error: string | null;
  } | null;
}

/**
 * Every registered job with its most recent run. `distinct on` gives one row per job name in one
 * query, ordered so that "most recent" is the row Postgres keeps; jobs that have never run come
 * back with `lastRun: null` rather than being left out — a job nobody has ever run is exactly the
 * one worth showing.
 */
export async function jobStatuses(ctx: Pick<Ctx, "role">): Promise<JobStatus[]> {
  if (ctx.role !== "admin") throw new Error("forbidden");
  const rows = await getDb()
    .selectDistinctOn([jobRuns.job], {
      job: jobRuns.job,
      startedAt: jobRuns.startedAt,
      finishedAt: jobRuns.finishedAt,
      status: jobRuns.status,
      error: jobRuns.error,
    })
    .from(jobRuns)
    .orderBy(jobRuns.job, desc(jobRuns.startedAt), desc(sql`${jobRuns.id}`));
  const byName = new Map(rows.map((row) => [row.job, row]));
  return JOBS.map((job) => {
    const last = byName.get(job.name);
    return {
      name: job.name,
      tier: job.tier,
      lastRun: last
        ? {
            startedAt: last.startedAt,
            finishedAt: last.finishedAt,
            status: last.status,
            error: last.error,
          }
        : null,
    };
  });
}
