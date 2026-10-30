import "server-only";
import { eq } from "drizzle-orm";
import { alertAdmins } from "@/platform/alerts/gotify";
import { redactForLog } from "@/platform/auth/logger";
import { getDb } from "@/platform/db/client";
import type { JobDefinition, RecordedTier } from "./registry";
import { jobRuns } from "./schema";

export type Status = "success" | "failed" | "skipped";
export type Outcome = { job: string; status: Status };

const MAX_ERROR_LENGTH = 2000;

/** Postgres text columns reject a NUL byte (22021); an error's message is untrusted text. */
function describeError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replaceAll("\u0000", "").slice(0, MAX_ERROR_LENGTH);
}

export async function recordSkipped(job: JobDefinition, tier: RecordedTier): Promise<void> {
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

export async function runAndRecord(job: JobDefinition, tier: RecordedTier): Promise<Status> {
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
    const reason = describeError(error);
    if (runId !== undefined) {
      try {
        await getDb()
          .update(jobRuns)
          .set({ status: "failed", finishedAt: new Date(), error: reason })
          .where(eq(jobRuns.id, runId));
      } catch (updateError) {
        console.error("[jobs] failed to record a failed run", redactForLog(updateError));
      }
    }
    // The admins hear about it (spec §10.4). `alertAdmins` never throws and does nothing at all
    // when Gotify is not configured, so this cannot turn one failure into two. The reason is the
    // message already redacted for `job_runs` — never a credential (spec §5.4).
    await alertAdmins({
      title: `Ledgerly: ${job.name} failed`,
      message: `The ${tier} job "${job.name}" failed.\n\n${reason}`,
      priority: 7,
    });
    return "failed";
  }
}
