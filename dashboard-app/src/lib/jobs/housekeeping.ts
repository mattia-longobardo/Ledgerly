/**
 * Daily retention sweep over the platform's own bookkeeping tables (Ruling
 * R9-5).
 *
 * Everything purged here is operational exhaust — audit trail, job and sync
 * history, webhook receipts, idempotency and rate-limit windows. No user
 * domain data is touched: a payslip, a transaction or a fund month is never a
 * candidate, and `payroll_retention` (which deletes document *bytes* only)
 * stays a separate job with its own configured window.
 *
 * `security_events` is in R9-5's list but not in this schema: the reduced
 * Phase 8 shipped personal access tokens without that table, so there is
 * nothing to purge. Add it to `RETENTION` when the table lands.
 *
 * Each table is capped at `PURGE_BATCH` rows per run so a mistaken window
 * cannot empty the audit trail in one tick — an operator gets a day, and the
 * per-table counts land in `job_runs.detail` for them to look at. A backlog
 * simply drains over several days.
 *
 * The whole sweep runs in the SYSTEM context: these tables are cross-user by
 * construction (`audit_events` spans every actor, `rate_limit_windows` every
 * principal), and several of them carry FORCE ROW LEVEL SECURITY, so a purge
 * under any one user's context would silently delete only that user's rows.
 */
import { sql, type SQL } from "drizzle-orm";
import { alertJobFailure } from "@/lib/clients/gotify";
import { errorMessage } from "@/lib/clients/http";
import type { JobResult } from "@/lib/contracts";
import { db } from "@/lib/db";
import type { DbClient } from "@/lib/db/client";
import { finishRun, startRun, withJobLock } from "@/lib/repo/jobs";
import { withSystemContext } from "@/platform/db/context";

export const JOB_NAME = "housekeeping" as const;
export const LOCK_KEY = JOB_NAME;

/** Rows deleted per table per run (Ruling R9-5). */
export const PURGE_BATCH = 5_000;

const DAY_MS = 86_400_000;

/** One purge rule. `cutoffDays` is documentation for the reader; the predicate is the truth. */
interface RetentionRule {
  table: string;
  cutoffDays: number | null;
  predicate(cutoff: Date, now: Date): SQL;
}

/**
 * `job_runs` and `sync_runs` are aged by when they FINISHED, because that is
 * when their history stops being interesting — with a fallback to `started_at`
 * so a run that died without ever finishing (a killed process leaves its row
 * `running` forever) is still collected once it is older than the window,
 * rather than living in the table for good.
 *
 * `webhook_deliveries` has no `created_at`; `received_at` is its timestamp.
 * `idempotency_keys` carries its own expiry, so the window is the row's, not
 * this job's.
 */
export const RETENTION: readonly RetentionRule[] = [
  {
    table: "audit_events",
    cutoffDays: 730,
    predicate: (cutoff) => sql`created_at < ${cutoff}`,
  },
  {
    table: "job_runs",
    cutoffDays: 90,
    predicate: (cutoff) => sql`COALESCE(finished_at, started_at) < ${cutoff}`,
  },
  {
    table: "sync_runs",
    cutoffDays: 90,
    predicate: (cutoff) => sql`COALESCE(finished_at, started_at) < ${cutoff}`,
  },
  {
    table: "webhook_deliveries",
    cutoffDays: 90,
    predicate: (cutoff) => sql`received_at < ${cutoff}`,
  },
  {
    table: "idempotency_keys",
    cutoffDays: null,
    predicate: (_cutoff, now) => sql`expires_at < ${now}`,
  },
  {
    table: "rate_limit_windows",
    cutoffDays: 1,
    predicate: (cutoff) => sql`window_start < ${cutoff}`,
  },
];

/**
 * Deletes at most `limit` matching rows and reports how many went.
 *
 * `ctid` rather than a primary key because the six tables do not share one:
 * two are composite-keyed, one is a bigint identity, three are uuids. A `ctid`
 * is only stable within a statement, which is exactly the scope it is used in
 * here — the CTE selects the victims and the same statement deletes them.
 *
 * No `ORDER BY`: any `limit` matching rows are as good as the oldest `limit`,
 * and a backlog drains over the following runs either way. Sorting a table
 * that is behind by millions of rows would be the expensive part of the sweep.
 */
async function purge(tx: DbClient, table: string, predicate: SQL, limit: number): Promise<number> {
  const target = sql.identifier(table);
  const res = await tx.execute<{ purged: number }>(sql`
    WITH doomed AS (
      SELECT ctid FROM ${target} WHERE ${predicate} LIMIT ${limit}
    ), deleted AS (
      DELETE FROM ${target} AS t USING doomed AS d WHERE t.ctid = d.ctid RETURNING 1
    )
    SELECT count(*)::int AS purged FROM deleted`);
  return Number(res.rows[0]?.purged ?? 0);
}

export interface HousekeepingCounts {
  /** Per-table row counts, keyed by table name. */
  purged: Record<string, number>;
  total: number;
  /** True when at least one table filled its batch — there is more to collect tomorrow. */
  capped: boolean;
}

/** The sweep itself, separated from the `job_runs` bookkeeping so tests can call it directly. */
export async function runHousekeeping(now: Date, limit = PURGE_BATCH): Promise<HousekeepingCounts> {
  const purged: Record<string, number> = {};
  let capped = false;
  for (const rule of RETENTION) {
    const cutoff = new Date(now.getTime() - (rule.cutoffDays ?? 0) * DAY_MS);
    // One transaction per table: a sweep of six tables must not hold a single
    // transaction open across all of them, and one table's failure leaves the
    // tables already collected collected.
    const count = await withSystemContext(db, (tx) => purge(tx, rule.table, rule.predicate(cutoff, now), limit));
    purged[rule.table] = count;
    if (count >= limit) capped = true;
  }
  const total = Object.values(purged).reduce((sum, n) => sum + n, 0);
  return { purged, total, capped };
}

export interface RunHousekeepingInput {
  trigger: "cron" | "manual";
  now: Date;
}

export async function runHousekeepingJob(input: RunHousekeepingInput): Promise<JobResult> {
  const run = await startRun({ jobName: JOB_NAME, trigger: input.trigger });
  try {
    const result = await withJobLock(LOCK_KEY, () => runHousekeeping(input.now, PURGE_BATCH));
    if (result === null) {
      const skipped = { reason: "lock_not_acquired" };
      await finishRun(run.id, "already_done", { detail: skipped });
      return { job: JOB_NAME, status: "already_done", detail: skipped };
    }
    const detail = { ...result.purged, total: result.total, capped: result.capped };
    await finishRun(run.id, "success", { detail });
    return { job: JOB_NAME, status: "success", detail };
  } catch (err) {
    const error = errorMessage(err);
    await finishRun(run.id, "failed", { error });
    await alertJobFailure({ job: JOB_NAME, error });
    return { job: JOB_NAME, status: "failed", error };
  }
}
