/**
 * The reconciliation decisions for the Trek leave sync — pure, so the policy can
 * be argued with in tests instead of in production.
 *
 * ── THE POLICY ───────────────────────────────────────────────────────────────
 * **Trek is authoritative for existence; the dashboard is a write-through
 * editor.**
 *
 * Concretely, one sync pass is PUSH first, then PULL:
 *
 *   1. PUSH every locally-staged edit to Trek (via the client's read-diff-toggle
 *      path, which is the only safe way to write a toggle endpoint).
 *   2. PULL the year back and take what Trek now reports as the truth.
 *
 * That order is the whole policy, and it is what makes a genuine conflict
 * impossible to get wrong. If the owner edited a day here and someone (or Trek's
 * own UI) edited the same day there, the push makes Trek match the local intent
 * and the pull then reads that back — so the dashboard edit wins, and both sides
 * end up agreeing. Doing it the other way round would let the pull overwrite an
 * edit the owner had just made and not yet sent, which is exactly the failure
 * that makes a bidirectional sync untrustworthy.
 *
 * WHY the dashboard wins a same-window conflict: a local pending row exists only
 * because the owner deliberately made that edit in this UI moments ago. A
 * Trek-side change within the same window is indistinguishable from local state
 * merely being stale, and there is no per-entry updated_at upstream to break the
 * tie with. Preferring the explicit, recent, attributable intent is the only
 * rule that keeps "those days can be edited from the personal dashboard" — the
 * owner's requirement 3 — actually true. And because the push diffs before it
 * writes, a conflict where Trek already agrees costs no request at all.
 *
 * WHEN THE PUSH FAILS the pull must not paper over it: those dates are SKIPPED,
 * keeping the local pending row intact so the next pass retries it. Silently
 * pulling Trek's version over an unsent edit would discard the owner's change
 * and report success.
 */

import type { LeaveFraction, LeaveKind, TrekEntry, DesiredDay } from "@/lib/clients/trek";
import type { LeaveDayRow } from "@/lib/repo/leave";

export interface PushPlan {
  /** Days to create or change upstream. */
  desired: DesiredDay[];
  /** Days to remove upstream. Explicit — never inferred from absence. */
  removals: string[];
}

/** Turns the locally-staged rows into the client's desired-state request. */
export function planPush(local: readonly LeaveDayRow[]): PushPlan {
  const desired: DesiredDay[] = [];
  const removals: string[] = [];

  for (const row of local) {
    if (row.pendingOp === "upsert") {
      desired.push({ date: row.date, fraction: row.fraction, kind: row.kind });
    } else if (row.pendingOp === "delete") {
      removals.push(row.date);
    }
  }

  return { desired, removals };
}

export interface PullUpsert {
  date: string;
  fraction: LeaveFraction;
  kind: LeaveKind;
  trekEntryId: number;
  note: string | null;
}

export interface PullPlan {
  /** Rows to write locally, because Trek has them and we do not (or differ). */
  upserts: PullUpsert[];
  /** Local rows to drop, because Trek no longer has them. */
  deletes: string[];
  /** Dates left alone because a local edit is still waiting to be pushed. */
  skipped: string[];
  /** Local rows already identical to Trek's — no write at all. */
  unchanged: string[];
}

function differs(local: LeaveDayRow, remote: TrekEntry): boolean {
  return (
    local.fraction !== remote.fraction ||
    local.kind !== remote.kind ||
    local.trekEntryId !== remote.id ||
    (local.note ?? "") !== remote.note
  );
}

/**
 * Decides what the local mirror should look like after a pull.
 *
 * `stillPending` is the set of dates whose push did NOT succeed in this pass —
 * they keep their local row and are skipped, so nothing the owner asked for is
 * lost to a failed upstream write.
 */
export function planPull(
  local: readonly LeaveDayRow[],
  remote: readonly TrekEntry[],
  stillPending: ReadonlySet<string> = new Set(),
): PullPlan {
  const remoteByDate = new Map<string, TrekEntry>();
  for (const e of remote) remoteByDate.set(e.date, e);

  const upserts: PullUpsert[] = [];
  const deletes: string[] = [];
  const skipped: string[] = [];
  const unchanged: string[] = [];
  const seen = new Set<string>();

  for (const row of local) {
    seen.add(row.date);
    const r = remoteByDate.get(row.date);

    if (stillPending.has(row.date)) {
      // The push for this date did not land. Leave it exactly as it is.
      skipped.push(row.date);
      continue;
    }

    if (row.pendingOp === "delete") {
      // The push succeeded (or the day was already gone): the intent is
      // satisfied, so the row that only existed to carry the delete goes too.
      if (r === undefined) deletes.push(row.date);
      else skipped.push(row.date);
      continue;
    }

    if (r === undefined) {
      // Trek is authoritative for existence: a day deleted there is deleted here.
      deletes.push(row.date);
      continue;
    }

    if (differs(row, r)) {
      upserts.push({
        date: r.date,
        fraction: r.fraction,
        kind: r.kind,
        trekEntryId: r.id,
        note: r.note === "" ? null : r.note,
      });
    } else {
      unchanged.push(row.date);
    }
  }

  for (const r of remote) {
    if (seen.has(r.date)) continue;
    upserts.push({
      date: r.date,
      fraction: r.fraction,
      kind: r.kind,
      trekEntryId: r.id,
      note: r.note === "" ? null : r.note,
    });
  }

  return { upserts, deletes, skipped, unchanged };
}

/**
 * Planned leave per month, in DAYS, summing fractions — a half day counts 0.5.
 *
 * This is the "previsto" side of the owner's requirement 4 and the only place
 * that converts the calendar into a monthly figure comparable with a payslip.
 */
export function plannedDaysByMonth(
  days: readonly { date: string; fraction: LeaveFraction }[],
): { month: string; days: number }[] {
  const perMonth = new Map<string, number>();
  for (const d of days) {
    const month = `${d.date.slice(0, 7)}-01`;
    perMonth.set(month, (perMonth.get(month) ?? 0) + d.fraction);
  }
  return [...perMonth.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    // Fractions are halves, so the sum is exact; toFixed guards the float sum
    // from producing 2.9999999999999996 for six halves.
    .map(([month, days]) => ({ month, days: Number(days.toFixed(2)) }));
}
