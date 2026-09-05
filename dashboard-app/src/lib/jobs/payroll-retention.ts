/**
 * Deletes payslip originals whose retention window has run out (Ruling R4-5).
 *
 * Deliberately narrow: it removes **document bytes only**, never a row and
 * never a payroll record, so an Earnings figure can still be explained ten
 * years after the PDF behind it is gone.
 *
 * `purgeExpiredOriginals` (`infrastructure/purge-expired-originals.ts`) is
 * itself the complete atomic unit for this job: it reads the cross-user
 * selection once under its own `withSystemContext`, then runs each item's
 * network delete and DB write inside that item's own short transaction,
 * resolving that item's document store from its owner's connection. This job
 * wraps the call in nothing but the advisory job lock — opening a transaction
 * of its own around it would be exactly the "a transaction spans the I/O"
 * defect Task 10 was fixed to remove, worse here because it is a batch.
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
