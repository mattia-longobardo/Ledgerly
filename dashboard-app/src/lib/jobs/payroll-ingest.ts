/**
 * Moves uploaded payslips through the pipeline: scan, then extract and parse.
 *
 * The shape is `interest-accrual.ts`'s, for the same reasons. The cross-user
 * selection (which imports are due) is read once under `withSystemContext`
 * (RLS's `app_is_system()` bypass, needed because this crosses every user);
 * each import's actual work then runs through `scanImport`/`parseImport`
 * (`infrastructure/ingest.ts`), which internally manage their own short
 * transactions around a confirm/record step, with the network I/O (store
 * fetch, clamd, the parser's LLM call) sandwiched between them (Ruling R4-8)
 * — *when called on their own*.
 *
 * Called from here, that discipline does not hold: `withJobLock`
 * (`src/lib/repo/jobs.ts`) opens its own `db.transaction(...)` for the
 * advisory lock and runs its callback — this whole per-import body,
 * `scanImport`/`parseImport` and all their network I/O included — inside
 * that open transaction. This is a known, pre-existing characteristic of
 * `withJobLock` shared by every job that uses it (`wallet-accounts-sync.ts`,
 * `interest-accrual.ts`, `sync-queue.ts` included), not something Phase 4
 * introduced or fixed. Rewriting `withJobLock` to stop transaction-wrapping
 * I/O is a platform-level decision tracked separately, not something this
 * job can opt out of on its own.
 *
 * Practical safety therefore does not come from transaction isolation here.
 * It comes from `scanImport`/`parseImport` being idempotent: re-running one
 * (because the surrounding transaction rolled back, or the tick was retried)
 * either re-confirms the same status transition or is a no-op, never a
 * double-apply.
 *
 * One import's failure is caught and counted per import (Phase 2's "a loop
 * over many owners needs per-item error isolation" lesson) rather than
 * aborting the whole tick.
 */
import { alertJobFailure } from "@/lib/clients/gotify";
import { errorMessage } from "@/lib/clients/http";
import type { JobResult } from "@/lib/contracts";
import { db } from "@/lib/db";
import { finishRun, startRun, withJobLock } from "@/lib/repo/jobs";
import type { DocumentStore, PayrollImport, PayrollImportStatus } from "@/modules/payroll/application/ports";
import { payrollDeps } from "@/modules/payroll/infrastructure/deps";
import { parseImport, scanImport } from "@/modules/payroll/infrastructure/ingest";
import { noopScanner } from "@/modules/payroll/infrastructure/noop-scanner";
import { permissionsForRoles } from "@/platform/auth/permissions";
import type { Principal } from "@/platform/auth/principal";
import { withSystemContext } from "@/platform/db/context";

export const JOB_NAME = "payroll_ingest" as const;
export const LOCK_KEY = JOB_NAME;

/** One tick's worth. Bounded so a backlog drains over several ticks rather than one long run. */
export const INGEST_BATCH = 20;

const DUE_STATUSES: readonly PayrollImportStatus[] = ["scanning", "extracting"];

export interface RunPayrollIngestInput {
  trigger: "cron" | "manual";
  now: Date;
}

/**
 * The job acts on the owner's behalf and needs `payroll.upload`/`payroll.review`
 * to satisfy `scanImport`/`parseImport`'s own `assertPermission`. It is not a
 * real session: the RLS context each of those functions opens for itself is
 * what actually scopes the work, and this only carries the owner's id so the
 * audit rows name the right person.
 */
function systemPrincipalFor(userId: string): Principal {
  const roles = ["owner"] as const;
  return { userId, organizationId: "", roles: [...roles], permissions: permissionsForRoles([...roles]) };
}

/**
 * A deps bag is required to build the imports repository, but the batch
 * selection below touches neither the store nor the scanner. This stands in
 * so the read needs no per-user store resolution — `scanImport`/`parseImport`
 * resolve the real ones themselves, per import, because the store lives on
 * the *owner's* connection.
 */
const UNREACHABLE_STORE: DocumentStore = {
  provider: "local",
  put: async () => {
    throw new Error("payroll_ingest's batch read must never touch the document store");
  },
  get: async () => {
    throw new Error("payroll_ingest's batch read must never touch the document store");
  },
  delete: async () => {
    throw new Error("payroll_ingest's batch read must never touch the document store");
  },
  listPrefix: async () => [],
};

async function due(): Promise<PayrollImport[]> {
  return withSystemContext(db, (tx) =>
    payrollDeps(tx, { documents: UNREACHABLE_STORE, scanner: noopScanner }).imports.listByStatusForAllUsers(
      DUE_STATUSES,
      INGEST_BATCH,
    ),
  );
}

interface Counts {
  considered: number;
  scanned: number;
  parsed: number;
  needsOcr: number;
  infected: number;
  scannerUnavailable: number;
  failed: number;
}

/**
 * `scanImport` and `parseImport` are each written as a complete atomic unit
 * (a short transaction confirms readiness, then the network I/O, then a
 * second short transaction records the outcome) — but see the module
 * doc-comment above: called from this job, `withJobLock` holds one
 * outer transaction open across all of it anyway. This function only
 * sequences the two calls for one import — it opens no *additional* context
 * of its own around either.
 */
async function ingestOne(item: PayrollImport, counts: Counts): Promise<void> {
  const principal = systemPrincipalFor(item.userId);

  if (item.status === "scanning") {
    const scanned = await scanImport(principal, item.id);
    if (scanned.outcome === "rejected_infected") {
      counts.infected += 1;
      return;
    }
    if (scanned.outcome === "scanner_unavailable") {
      counts.scannerUnavailable += 1;
      return;
    }
    if (scanned.outcome === "skipped") return;
    counts.scanned += 1;
  }

  const parsed = await parseImport(principal, item.id);
  if (parsed.outcome === "parsed") counts.parsed += 1;
  else if (parsed.outcome === "needs_ocr") counts.needsOcr += 1;
}

export async function runPayrollIngestJob(input: RunPayrollIngestInput): Promise<JobResult> {
  const run = await startRun({ jobName: JOB_NAME, trigger: input.trigger });
  try {
    const items = await due();
    const counts: Counts = {
      considered: items.length,
      scanned: 0,
      parsed: 0,
      needsOcr: 0,
      infected: 0,
      scannerUnavailable: 0,
      failed: 0,
    };
    for (const item of items) {
      try {
        await withJobLock(`${LOCK_KEY}:${item.id}`, () => ingestOne(item, counts));
      } catch (err) {
        counts.failed += 1;
        console.error(
          JSON.stringify({ level: "error", event: "payroll_ingest_failed", importId: item.id, error: errorMessage(err) }),
        );
      }
    }
    await finishRun(run.id, "success", { detail: { ...counts } });
    return { job: JOB_NAME, status: "success", detail: { ...counts } };
  } catch (err) {
    const error = errorMessage(err);
    await finishRun(run.id, "failed", { error });
    await alertJobFailure({ job: JOB_NAME, error });
    return { job: JOB_NAME, status: "failed", error };
  }
}
