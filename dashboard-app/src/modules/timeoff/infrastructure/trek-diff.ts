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
import type { TimeoffCode, TimeoffEvent } from "../application/ports";

/**
 * R7-2, in both directions. Trek models exactly two kinds; `permits` is a type
 * this dashboard has and Trek does not, so a permits day is invisible to the
 * whole conversation below — it is never offered as a desired day, and it is
 * never in the local set a pull is diffed against. (`trekEvents` is what keeps
 * the second half true: without it Trek's "I do not have this day" would
 * delete a permits day the owner booked here.)
 */
const TREK_KIND_BY_CODE: Readonly<Record<string, LeaveKind>> = {
  vacation: "vacation",
  comp: "comp",
};

const CODE_BY_TREK_KIND: Readonly<Record<LeaveKind, TimeoffCode>> = {
  vacation: "vacation",
  comp: "comp",
};

/** The Trek kind a type maps to, or null when Trek cannot hold this type at all. */
export function trekKindOf(typeCode: string): LeaveKind | null {
  return TREK_KIND_BY_CODE[typeCode] ?? null;
}

export function typeCodeOf(kind: LeaveKind): TimeoffCode {
  return CODE_BY_TREK_KIND[kind];
}

/** The events Trek can hold — everything a pull is allowed to reason about. */
export function trekEvents(events: readonly TimeoffEvent[]): TimeoffEvent[] {
  return events.filter((event) => trekKindOf(event.typeCode) !== null);
}

/**
 * `numeric(3,2)` → Trek's numeric fraction, and back. This is the one boundary
 * where a stored quantity becomes a number, and it is safe because the CHECK
 * admits exactly two values.
 */
export function trekFraction(fraction: string): LeaveFraction {
  return fraction === "0.50" || fraction === "0.5" ? 0.5 : 1;
}

export function storedFraction(fraction: LeaveFraction): string {
  return fraction === 0.5 ? "0.50" : "1.00";
}

export interface PushPlan {
  /** Days to create or change upstream. */
  desired: DesiredDay[];
  /** Days to remove upstream. Explicit — never inferred from absence. */
  removals: string[];
}

/**
 * Turns the locally-staged rows into the client's desired-state request.
 *
 * A staged `permits` upsert produces nothing: R7-2 says those days are never
 * pushed. A staged DELETE is not filtered by kind, because a day that Trek
 * does hold must be removed there whatever the local type says about it now.
 */
export function planPush(local: readonly TimeoffEvent[]): PushPlan {
  const desired: DesiredDay[] = [];
  const removals: string[] = [];

  for (const row of local) {
    if (row.pendingOp === "upsert") {
      const kind = trekKindOf(row.typeCode);
      if (kind === null) continue;
      desired.push({ date: row.date, fraction: trekFraction(row.fraction), kind });
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

function differs(local: TimeoffEvent, remote: TrekEntry): boolean {
  return (
    local.fraction !== storedFraction(remote.fraction) ||
    local.typeCode !== typeCodeOf(remote.kind) ||
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
  local: readonly TimeoffEvent[],
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
