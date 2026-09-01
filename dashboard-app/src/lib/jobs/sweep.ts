/**
 * Hourly catch-all — PLAN §5. Four jobs in one pass, each isolated so one
 * upstream outage cannot stop the others:
 *
 *   (c) retry Teable writes stuck in `pending_teable`;
 *   (a) snapshot catch-up inside the 3-day grace window, `missed` beyond it;
 *   (b) payslip polling fallback (diff Paperless against known doc ids);
 *   (d) refresh the Teable read cache so page loads never block on an API.
 *
 * Retries run before catch-up on purpose: a month persisted by (a) whose Teable
 * write fails would otherwise be retried again by (c) in the same sweep, burning
 * two of its eight attempts in one hour.
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
import { alertJobFailure } from "@/lib/clients/gotify";
import { listPayslipDocuments } from "@/lib/clients/paperless";
import { listAllocationRecords, pivotToSeries, type TeablePoint } from "@/lib/clients/teable";
import { REVOLUT_COMPONENT_KEYS } from "@/lib/clients/wallet-accounts";
import { REFRESH_STALENESS_MS, type JobResult } from "@/lib/contracts";
import { toCents } from "@/lib/calc/money";
import { isStale, snapshotGrace } from "@/lib/calc/staleness";
import { env } from "@/lib/env";
import { touchHeartbeat } from "@/lib/jobs/heartbeat";
import { ingestPayslipDocument } from "@/lib/jobs/payslip-ingest";
import { runMonthlySnapshot, JOB_NAME as SNAPSHOT_JOB } from "@/lib/jobs/monthly-snapshot";
import {
  latestBalances,
  recordSnapshots,
  recordedTeableMonths,
  type SnapshotInput,
} from "@/lib/repo/balances";
import {
  allMonthKeys,
  finishRun,
  markSnapshotStatus,
  pendingTeableWrites,
  recentRuns,
  startRun,
} from "@/lib/repo/jobs";
import { knownDocIds } from "@/lib/repo/payslips";
import { list as listTrackedAccounts } from "@/lib/repo/tracked-accounts";
import type { TrackedAccount } from "@/lib/db/schema";
import {
  addMonths,
  monthKey as currentMonthKey,
  monthRange,
  monthStartInstant,
} from "@/lib/time";

export const JOB_NAME = "sweep" as const;

/** A long outage must not turn one sweep into an unbounded backfill. */
export const MAX_CATCHUP_MONTHS = 12;

/** How far back a `missed` marker is looked for before alerting again. */
const MISSED_RUN_LOOKBACK = 200;

/**
 * Wallet owns the CURRENT value of these keys; the Teable refresh must not
 * overwrite them with month-old Allocation values. Their *history* is a
 * different question — see `backfillPoints`.
 */
const WALLET_OWNED_KEYS: readonly string[] = [
  "ing",
  "revolut_total",
  ...REVOLUT_COMPONENT_KEYS,
];

/**
 * Nothing reads `account_key = 'total'` any more. Teable's TOTAL is a formula
 * that omits Fondo Cometa and, on app-written rows, every hand-tracked account
 * — see the note on TEABLE_TOTAL_FIELD. Net worth is summed from the account
 * columns in `src/lib/calc/networth.ts`, so writing a `total` row would only
 * leave a wrong number lying around for someone to find later.
 */
const NEVER_CACHED_KEYS: readonly string[] = ["total"];

/**
 * The gate reads these two and no more. They are the accounts that appear in
 * every Allocation row, so "have they been refreshed recently?" is answerable.
 * Including a column the owner has never filled in (EToro has no value in any
 * row today) would mean the gate never had a full set and never held.
 */
const TEABLE_FRESHNESS_KEYS = ["fideuram", "cometa"];

export interface RunSweepInput {
  trigger?: "cron" | "manual";
  now?: Date;
}

interface StepReport {
  errors: string[];
  detail: Record<string, unknown>;
}

/** (c) Rows already carrying their 23:59 values: replay only the Teable write. */
async function retryPendingWrites(now: Date, report: StepReport): Promise<void> {
  const pending = await pendingTeableWrites();
  const results: Record<string, string> = {};
  for (const row of pending) {
    const result = await runMonthlySnapshot({
      monthKey: row.monthKey,
      trigger: "sweep",
      now,
    });
    results[row.monthKey] = result.status;
  }
  report.detail.pendingRetries = results;
}

/**
 * (a) A month with no `monthly_snapshots` row at all. Months that already have
 * a row — pending, poisoned or missed — are handled by (c) or by a manual
 * action, never re-discovered here.
 */
function missingMonths(known: readonly string[], now: Date): string[] {
  const current = currentMonthKey(now);
  const newest = known.length > 0 ? known.reduce((a, b) => (a > b ? a : b)) : null;
  const from = newest === null ? current : addMonths(newest, 1);
  const candidates = monthRange(from, current);
  const bounded = candidates.slice(-MAX_CATCHUP_MONTHS);
  const seen = new Set(known);
  return bounded.filter((m) => !seen.has(m));
}

async function alreadyMarkedMissed(monthKey: string): Promise<boolean> {
  const runs = await recentRuns(SNAPSHOT_JOB, MISSED_RUN_LOOKBACK);
  return runs.some((r) => r.dedupeKey === monthKey && r.status === "missed");
}

async function catchUpSnapshots(now: Date, report: StepReport): Promise<void> {
  const graceDays = env().SNAPSHOT_GRACE_DAYS;
  const months = missingMonths(await allMonthKeys(), now);
  const outcomes: Record<string, string> = {};

  for (const month of months) {
    const grace = snapshotGrace(month, now, graceDays);

    // 'due' is the fire day itself: the 23:59 cron owns it, and running early
    // would capture balances from the wrong moment.
    if (grace === "due") {
      outcomes[month] = "due";
      continue;
    }

    if (grace === "in_grace") {
      const result = await runMonthlySnapshot({ monthKey: month, trigger: "sweep", now });
      outcomes[month] = result.status;
      continue;
    }

    // Beyond the window. Nothing can be reconstructed — the balances are gone —
    // so this is a one-shot notification and then silence until the owner
    // decides via the in-app "run now".
    if (await alreadyMarkedMissed(month)) {
      outcomes[month] = "missed_already_reported";
      continue;
    }
    const run = await startRun({
      jobName: SNAPSHOT_JOB,
      trigger: "sweep",
      dedupeKey: month,
    });
    // No-op when the month has no row, which is the usual case: a missing month
    // is missing precisely because phase 2 never ran.
    await markSnapshotStatus(month, "missed");
    await finishRun(run.id, "missed", {
      detail: { monthKey: month, graceDays, requiresManualAction: true },
    });
    await alertJobFailure({
      job: SNAPSHOT_JOB,
      monthKey: month,
      error: `no snapshot was taken and the ${graceDays}-day grace window has closed; the 23:59 balances for this month cannot be reconstructed. Use "run now" to record today's values instead.`,
    });
    outcomes[month] = "missed";
  }

  report.detail.snapshotCatchUp = outcomes;
}

/** (b) The webhook is a latency optimisation; this is the correctness path. */
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

/** A cacheable point: has a value, and is not the TOTAL formula. */
function cacheable(point: TeablePoint): boolean {
  return point.value !== null && !NEVER_CACHED_KEYS.includes(point.key);
}

/**
 * The current value of every APP-MANAGED column Teable owns (Fideuram, Fondo
 * Cometa). Hand-tracked accounts are handled by `handTrackedLatest` instead,
 * because their rule is different — see there — so they are skipped here.
 *
 * PLAN.md §2: the current value of a managed account is "the latest Allocation
 * value for that column" — per column, not per row. Taking the newest month
 * globally instead drops any account whose cell is blank there: with the
 * September 2026 row filled in for Fideuram but not for Fondo Cometa, Cometa
 * vanished from the cache entirely and the dashboard showed nothing for it,
 * even though August held a perfectly good 2.228,13.
 *
 * For these accounts an empty cell still stays a gap — a 0 would be a lie in
 * every average — so the last real figure is carried. `raw.month` records which
 * month each value came from, so the UI can tell how old it is.
 *
 * `>=` rather than `>` on the month: two rows can share a month (2026-08-31T22:00Z
 * is 2026-09-01 in Rome), and `listAllocationRecords` hands them over in Date
 * order, so the later row must win.
 */
function latestPoints(points: readonly TeablePoint[], handTracked: ReadonlySet<string>): TeablePoint[] {
  const latestByKey = new Map<string, TeablePoint>();
  for (const point of points) {
    if (!cacheable(point)) continue;
    if (WALLET_OWNED_KEYS.includes(point.key)) continue;
    if (handTracked.has(point.key)) continue;
    const seen = latestByKey.get(point.key);
    if (!seen || point.month >= seen.month) latestByKey.set(point.key, point);
  }
  return [...latestByKey.values()];
}

/** A hand-tracked snapshot the sweep is about to write: a real 0 is a value. */
interface HandPoint {
  key: string;
  column: string;
  month: string;
  value: number;
}

/**
 * The current value of every HAND-TRACKED account — the WYSIWYG rule the owner
 * asked for: it is the account's cell in the MOST RECENT Allocation row
 * (max Europe/Rome `Date`), and **0** when that cell is empty, when the column
 * has been deleted, or when there are no rows at all. There is NO carry-forward:
 * unlike Fideuram/Cometa, a blank newest cell is a real 0, not a gap hiding an
 * older figure. "La somma non mi torna, è 0; cella vuota vale 0."
 *
 * The value is read at `newestMonth` (the max month across the table). Within
 * that month the last non-null cell wins — the same last-wins the managed path
 * uses when two rows share a month — and absent means 0. Every registered
 * account gets a row even when Teable knows nothing about it, which is exactly
 * what keeps a column-less account pinned at 0 instead of vanishing.
 */
function handTrackedLatest(
  points: readonly TeablePoint[],
  tracked: readonly TrackedAccount[],
  newestMonth: string,
): HandPoint[] {
  const valueAtNewest = new Map<string, number>();
  for (const point of points) {
    if (point.month !== newestMonth) continue;
    if (point.value === null) continue;
    valueAtNewest.set(point.key, point.value);
  }
  return tracked.map((account) => ({
    key: account.slug,
    column: account.teableColumn,
    month: newestMonth,
    value: valueAtNewest.get(account.slug) ?? 0,
  }));
}

/**
 * One point per `(account, month)` the Allocation table actually holds — the
 * history the net-worth chart is drawn from.
 *
 * Why this is needed at all: the refresh above only ever writes the single
 * newest value per column, stamped `now`, so `balance_snapshots` had no
 * per-month history for the hand-tracked accounts whatsoever. A summed
 * net-worth series built from that would have been one point wide. The
 * Allocation table has held the real monthly history since January; it just was
 * never ingested.
 *
 * Wallet-owned keys are backfilled too, but only for months already closed.
 * Skipping them entirely (the obvious reading) would leave ING and Revolut
 * absent from every month before this app existed, and since carry-forward
 * refuses to run backwards, the net-worth curve would have jumped by the whole
 * ING+Revolut balance in the month the app started — a fake five-figure gain in
 * the delta badge. Restricting them to closed months is what keeps Wallet
 * authoritative for the present: a backfilled row is stamped at the FIRST
 * instant of its month, so it can never outrank today's live capture.
 *
 * Hand-tracked accounts are the exception to "empty is a gap": each gets a point
 * for EVERY month the table holds, its own cell or an explicit 0, with no
 * carry-forward. That is what lets the net-worth series sum them as real values
 * (0 included) instead of leaving holes, and it is the series half of the
 * owner's WYSIWYG rule — a blank month is worth 0, not last month's figure.
 */
function backfillPoints(
  points: readonly TeablePoint[],
  now: Date,
  tracked: readonly TrackedAccount[],
): HandPoint[] {
  const current = currentMonthKey(now);
  const handTracked = new Set(tracked.map((t) => t.slug));
  const byKeyMonth = new Map<string, HandPoint>();

  // Managed + wallet-owned columns: unchanged. An empty cell is a gap (skipped
  // by `cacheable`), and wallet-owned keys are backfilled for closed months only.
  for (const point of points) {
    if (handTracked.has(point.key)) continue;
    if (!cacheable(point)) continue;
    if (WALLET_OWNED_KEYS.includes(point.key) && point.month >= current) continue;
    // Last write wins: records arrive in Date order and `pivotToSeries` sorts
    // stably, so within a month the later row is the later value.
    byKeyMonth.set(`${point.key}@${point.month}`, {
      key: point.key,
      column: point.column,
      month: point.month,
      value: point.value as number,
    });
  }

  // Hand-tracked columns: each month the table holds gets the account's own
  // cell, or an explicit 0 where empty — every month, no carry-forward, so the
  // net-worth series can sum them as real values. A column that no longer
  // exists simply reads 0 in every month.
  const months = new Set(points.map((p) => p.month));
  const realValue = new Map<string, number>();
  for (const point of points) {
    if (!handTracked.has(point.key)) continue;
    if (point.value === null) continue;
    realValue.set(`${point.key}@${point.month}`, point.value);
  }
  for (const account of tracked) {
    for (const month of months) {
      const id = `${account.slug}@${month}`;
      byKeyMonth.set(id, {
        key: account.slug,
        column: account.teableColumn,
        month,
        value: realValue.get(id) ?? 0,
      });
    }
  }

  return [...byKeyMonth.values()];
}

/**
 * `(account, month, value)` — the fingerprint the backfill dedupes on.
 *
 * Cents, not the raw string: Teable hands back `820` where Postgres `numeric(14,2)`
 * reads back `820.00`, and comparing those as text would re-insert every row on
 * every sweep.
 */
function fingerprint(accountKey: string, month: string, value: string | number | null): string {
  return `${accountKey}@${month}@${toCents(value)}`;
}

/**
 * (d) Teable, 1-hour refresh budget. Two writes: the current value per column,
 * and any month of history not already recorded.
 *
 * Idempotency of the backfill — the sweep runs hourly and re-reads the whole
 * table every time, so this has to be exactly-once or the table grows for ever.
 * `recordedTeableMonths()` returns every `(account, month, value)` already
 * written from Teable and a point is inserted only when its fingerprint is
 * absent, so a steady state inserts nothing. This holds for the hand-tracked
 * empty=0 rows too: `fingerprint` compares integer cents and `toCents(0)` is 0,
 * a real, stable fingerprint — so an account that reads 0 in a month is written
 * once and then recognised for ever, exactly like a non-zero value. When the
 * owner CORRECTS a past month by hand (including 0 → a real figure) the
 * fingerprint changes, one row is inserted, and the next sweep sees the new
 * fingerprint and stops: bounded at one extra row per correction, never per
 * hour. A read-then-insert was chosen over
 * `ON CONFLICT DO NOTHING` deliberately — `balance_snapshots` has no unique
 * constraint to hang one on, and adding one would need a migration against a
 * live table whose existing rows are not unique on `(account_key, captured_at)`.
 */
async function refreshTeableCache(now: Date, report: StepReport): Promise<void> {
  const cached = await latestBalances(TEABLE_FRESHNESS_KEYS);
  const oldest =
    cached.length < TEABLE_FRESHNESS_KEYS.length
      ? null
      : cached.reduce((a, b) => (a.capturedAt < b.capturedAt ? a : b));
  if (oldest && !isStale(oldest.capturedAt, REFRESH_STALENESS_MS.teable, now)) {
    report.detail.teableCache = "fresh";
    return;
  }

  const points = pivotToSeries(await listAllocationRecords());
  if (points.length === 0) {
    report.detail.teableCache = "empty";
    return;
  }

  // The hand-tracked registry is the source of truth for empty=0: an account
  // listed here is valued even when Teable no longer has its column.
  const tracked = await listTrackedAccounts();
  const handTrackedKeys = new Set(tracked.map((t) => t.slug));
  const newestMonth = points.reduce((a, b) => (a.month > b.month ? a : b)).month;

  const latest = latestPoints(points, handTrackedKeys);
  const rows: SnapshotInput[] = latest.map((p) => ({
    source: "teable" as const,
    accountKey: p.key,
    balance: String(p.value),
    raw: { month: p.month, column: p.column, kind: "latest" },
    capturedAt: now,
  }));

  // Hand-tracked scalars: newest row's cell, 0 if empty/column-gone. Always
  // written (a 0 latest row is what pins a column-less account at 0), stamped
  // `now` like every other latest row.
  const handLatest = handTrackedLatest(points, tracked, newestMonth);
  rows.push(
    ...handLatest.map((p) => ({
      source: "teable" as const,
      accountKey: p.key,
      balance: String(p.value),
      raw: { month: p.month, column: p.column, kind: "latest" },
      capturedAt: now,
    })),
  );

  const known = new Set(
    (await recordedTeableMonths()).map((r) => fingerprint(r.accountKey, r.month, r.balance)),
  );
  const backfill = backfillPoints(points, now, tracked).filter(
    (p) => !known.has(fingerprint(p.key, p.month, p.value)),
  );
  rows.push(
    ...backfill.map((p) => ({
      source: "teable" as const,
      accountKey: p.key,
      balance: String(p.value),
      raw: { month: p.month, column: p.column, kind: "history" },
      capturedAt: monthStartInstant(p.month),
    })),
  );

  await recordSnapshots(rows);
  report.detail.teableCache = {
    newestMonth,
    keys: latest.length + handLatest.length,
    months: Object.fromEntries([
      ...latest.map((p) => [p.key, p.month] as const),
      ...handLatest.map((p) => [p.key, p.month] as const),
    ]),
    backfilled: backfill.length,
  };
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
 * alerted: at an hourly cadence a flapping upstream would be pure alert noise,
 * and the paths that genuinely need attention — a poisoned snapshot, a missed
 * month — alert from where they happen. Silence here is covered by the
 * heartbeat and by `job_last_success_timestamp` in Grafana.
 */
export async function runSweep(input: RunSweepInput = {}): Promise<JobResult> {
  const now = input.now ?? new Date();
  const run = await startRun({ jobName: JOB_NAME, trigger: input.trigger ?? "cron" });
  const report: StepReport = { errors: [], detail: {} };

  try {
    await step("teable_write_retries", report, () => retryPendingWrites(now, report));
    await step("snapshot_catch_up", report, () => catchUpSnapshots(now, report));
    await step("payslip_polling", report, () => pollPayslips(report));
    await step("teable_cache", report, () => refreshTeableCache(now, report));
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
