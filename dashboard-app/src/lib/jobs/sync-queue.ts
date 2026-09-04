import { errorMessage } from "@/lib/clients/http";
import type { JobResult } from "@/lib/contracts";
import { db } from "@/lib/db";
import { finishRun, startRun, withJobLock } from "@/lib/repo/jobs";
import { drainSyncQueue } from "@/modules/integrations/application/drain-sync-queue";
import { integrationDeps } from "@/modules/integrations/infrastructure/deps";

export const JOB_NAME = "sync_queue" as const;
export const LOCK_KEY = JOB_NAME;

export interface RunSyncQueueInput {
  trigger?: "cron" | "manual";
}

/**
 * Drains the `sync_runs` rows a webhook queued (spec §3.4).
 *
 * Deliberately quiet and deliberately un-alerting: an empty queue is the normal
 * state, and a run that failed has already recorded why on its own row — the
 * Integrations page shows it, and alerting here would duplicate that hourly.
 * The advisory lock is belt and braces: `runs.claim` already makes a double
 * execution impossible, so a second tick would simply find nothing.
 *
 * No `ensureProvidersRegistered()` call here: the provider registry bootstrap
 * (`@/platform/integrations/register-all`) does not exist yet — it lands with
 * the first real adapter — and until a provider is registered no connection
 * can exist for `drainSyncQueue` to find work against.
 */
export async function runSyncQueue(input: RunSyncQueueInput = {}): Promise<JobResult> {
  const run = await startRun({ jobName: JOB_NAME, trigger: input.trigger ?? "cron" });
  try {
    const drained = await withJobLock(LOCK_KEY, () => drainSyncQueue(integrationDeps(db))(20));
    if (drained === null) {
      const skipped = { reason: "lock_not_acquired" };
      await finishRun(run.id, "already_done", { detail: skipped });
      return { job: JOB_NAME, status: "already_done", detail: skipped };
    }
    if (drained.length === 0) {
      const skipped = { reason: "queue_empty" };
      await finishRun(run.id, "already_done", { detail: skipped });
      return { job: JOB_NAME, status: "already_done", detail: skipped };
    }
    const detail = {
      drained: drained.length,
      failed: drained.filter((r) => r.status === "failed").length,
    };
    await finishRun(run.id, "success", { detail });
    return { job: JOB_NAME, status: "success", detail };
  } catch (err) {
    const error = errorMessage(err);
    await finishRun(run.id, "failed", { error });
    return { job: JOB_NAME, status: "failed", error };
  }
}
