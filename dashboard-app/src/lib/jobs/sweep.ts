/**
 * Hourly catch-all — PLAN §5. Now just the heartbeat the compose healthcheck
 * watches.
 *
 * The snapshot catch-up (the old step a) and the legacy-spreadsheet steps (c,
 * the pending-write retry, and d, the read-cache refresh) went away with that
 * whole integration: there is no snapshot job left to catch up on, no queued
 * write to retry, and no upstream cache to keep warm. `monthly_close`
 * (`src/lib/jobs/monthly-close.ts`) replaced the snapshot; it runs on the
 * monthly tier and needs no hourly babysitting.
 *
 * Wallet used to be refreshed here too. It is not any more: Wallet syncs itself
 * at noon, so polling it hourly bought nothing, and it now has its own daily job
 * (`src/lib/jobs/wallet-refresh.ts`, cron 12:00 Europe/Rome). The payslip
 * polling fallback is gone too (Task 22): `payroll_ingest` (Phase 4) owns
 * document ingestion now. The heartbeat stays here — the health endpoint's
 * window is two hours, so a daily job touching it would risk an autoheal
 * restart loop.
 *
 * Ends by touching the heartbeat the compose healthcheck watches.
 */

import type { JobResult } from "@/lib/contracts";
import { touchHeartbeat } from "@/lib/jobs/heartbeat";
import { finishRun, startRun } from "@/lib/repo/jobs";

export const JOB_NAME = "sweep" as const;

export interface RunSweepInput {
  trigger?: "cron" | "manual";
  now?: Date;
}

interface StepReport {
  errors: string[];
  detail: Record<string, unknown>;
}

/**
 * Never throws. Step failures are collected into the run's detail rather than
 * alerted: at an hourly cadence a flapping upstream would be pure alert noise.
 * Silence here is covered by the heartbeat and by `job_last_success_timestamp`
 * in Grafana.
 */
export async function runSweep(input: RunSweepInput = {}): Promise<JobResult> {
  const now = input.now ?? new Date();
  const run = await startRun({ jobName: JOB_NAME, trigger: input.trigger ?? "cron" });
  const report: StepReport = { errors: [], detail: {} };

  try {
    // Every step this job used to run has been replaced by a job of its own —
    // the snapshot catch-up, the legacy-spreadsheet retry, the read-cache
    // refresh, the wallet refresh, and now the payslip polling that
    // `payroll_ingest` (Phase 4) took over. What remains is the heartbeat, and
    // that is the point: `/api/health` reads it to answer "did the scheduler
    // fire?", which no other job answers.
  } finally {
    // Touched even on a bad sweep: the heartbeat answers "did the scheduler
    // fire?", not "was every upstream reachable?".
    report.detail.heartbeat = await touchHeartbeat(now);
  }

  if (report.errors.length > 0) {
    const error = report.errors.join("; ");
    await finishRun(run.id, "failed", { error, detail: report.detail });
    return { job: JOB_NAME, status: "failed", error, detail: report.detail };
  }

  await finishRun(run.id, "success", { detail: report.detail });
  return { job: JOB_NAME, status: "success", detail: report.detail };
}
