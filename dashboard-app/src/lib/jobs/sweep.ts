/**
 * Hourly catch-all — PLAN §5. Now just the payslip polling fallback, plus the
 * heartbeat the compose healthcheck watches.
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
 * (`src/lib/jobs/wallet-refresh.ts`, cron 12:00 Europe/Rome). The heartbeat
 * stays here — the health endpoint's window is two hours, so a daily job
 * touching it would risk an autoheal restart loop.
 *
 * Ends by touching the heartbeat the compose healthcheck watches.
 */

import { errorMessage } from "@/lib/clients/http";
import { listPayslipDocuments } from "@/lib/clients/paperless";
import type { JobResult } from "@/lib/contracts";
import { touchHeartbeat } from "@/lib/jobs/heartbeat";
import { ingestPayslipDocument } from "@/lib/jobs/payslip-ingest";
import { finishRun, startRun } from "@/lib/repo/jobs";
import { knownDocIds } from "@/lib/repo/payslips";

export const JOB_NAME = "sweep" as const;

export interface RunSweepInput {
  trigger?: "cron" | "manual";
  now?: Date;
}

interface StepReport {
  errors: string[];
  detail: Record<string, unknown>;
}

/** The webhook is a latency optimisation; this is the correctness path. */
async function pollPayslips(report: StepReport): Promise<void> {
  const documents = await listPayslipDocuments();
  const known = new Set(await knownDocIds());
  const fresh = documents.filter((d) => !known.has(d.id));
  const results: Record<number, string> = {};
  for (const doc of fresh) {
    const result = await ingestPayslipDocument({ docId: doc.id, trigger: "sweep" });
    results[doc.id] = result.status;
  }
  report.detail.payslipPolling = { seen: documents.length, ingested: results };
}

async function step(name: string, report: StepReport, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    report.errors.push(`${name}: ${errorMessage(err)}`);
  }
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
    await step("payslip_polling", report, () => pollPayslips(report));
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
