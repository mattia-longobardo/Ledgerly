/**
 * Deletes payslip originals whose retention window has run out (Ruling R4-5).
 *
 * Deliberately narrow: it removes **document bytes only**, never a row and
 * never a payroll record, so an Earnings figure can still be explained ten
 * years after the PDF behind it is gone.
 *
 * `purgeExpiredOriginals` (`infrastructure/purge-expired-originals.ts`) is
 * written as a per-item atomic unit: it reads the cross-user selection once
 * under its own `withSystemContext`, then runs each item's network delete
 * and DB write inside that item's own short transaction, resolving that
 * item's document store from its owner's connection. That per-item isolation
 * holds when this job calls it: `withJobLock` (`src/lib/repo/jobs.ts`, Ruling
 * R9-1) takes a session-level advisory lock on a client of its own and runs
 * its callback with no transaction open, so each item keeps its own short
 * transaction and the store delete stays outside one.
 *
 * Safety across a retried tick rests on idempotency:
 * `listPurgeableForAllUsers` never re-selects a row whose `storage_key` is
 * already null, so re-running a partially-completed batch is safe to repeat.
 *
 * A `failed` count above zero is alerted but does **not** fail the run: the
 * batch did what it could, the rows keep their keys, and the next tick
 * retries — but an operator should know a store is refusing deletes.
 */
import { alertJobFailure } from "@/lib/clients/gotify";
import { errorMessage } from "@/lib/clients/http";
import type { JobResult } from "@/lib/contracts";
import { finishRun, startRun, withJobLock } from "@/lib/repo/jobs";
import { PURGE_BATCH, purgeExpiredOriginals } from "@/modules/payroll/infrastructure/purge-expired-originals";

export const JOB_NAME = "payroll_retention" as const;
export const LOCK_KEY = JOB_NAME;

export interface RunPayrollRetentionInput {
  trigger: "cron" | "manual";
  now: Date;
}

export async function runPayrollRetentionJob(input: RunPayrollRetentionInput): Promise<JobResult> {
  const run = await startRun({ jobName: JOB_NAME, trigger: input.trigger });
  try {
    const result = await withJobLock(LOCK_KEY, () => purgeExpiredOriginals(input.now, PURGE_BATCH));
    const detail = result ?? { considered: 0, purged: 0, failed: 0 };
    await finishRun(run.id, "success", { detail: { ...detail } });
    if (detail.failed > 0) {
      await alertJobFailure({
        job: JOB_NAME,
        error: `${detail.failed} original(s) could not be deleted from the document store`,
      });
    }
    return { job: JOB_NAME, status: "success", detail: { ...detail } };
  } catch (err) {
    const error = errorMessage(err);
    await finishRun(run.id, "failed", { error });
    await alertJobFailure({ job: JOB_NAME, error });
    return { job: JOB_NAME, status: "failed", error };
  }
}
