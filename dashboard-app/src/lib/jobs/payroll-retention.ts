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
 * does not actually hold once this job calls it, though: `withJobLock`
 * (`src/lib/repo/jobs.ts`) opens its own `db.transaction(...)` for the
 * advisory lock and runs its callback inside it — so the entire batch
 * (every item's network delete and DB write) executes nested inside that one
 * outer transaction, held open for the whole run.
 *
 * This is a known, pre-existing characteristic of `withJobLock` itself, also
 * present in `wallet-accounts-sync.ts`, `interest-accrual.ts`, and
 * `sync-queue.ts` — not something Phase 4 introduced or fixed, and not
 * something this job works around by construction. Safety instead rests on
 * idempotency: `listPurgeableForAllUsers` never re-selects a row whose
 * `storage_key` is already null, so re-running a partially-completed batch
 * (whether from the outer transaction rolling back or a retried tick) is
 * safe to repeat rather than relying on transaction isolation between items.
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
