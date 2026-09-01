/**
 * Net worth = Σ of the per-account latest known values.
 *
 * Why this module exists at all: the headline figure used to be Teable's
 * `TOTAL` column, a per-row formula summing that row's account cells. The
 * monthly snapshot job appends rows carrying only Date + ING + Revolut, so an
 * app-written row's `TOTAL` silently omits every hand-tracked account — and
 * because a formula cell is never null, the "keep the newest non-null value per
 * column" rule in the Teable refresh adopted that truncated figure instantly.
 * Live evidence, 2026-09-01: the August row totalled 21 494,35 across six
 * accounts; the September row, written by the app, totalled 20 839,13 from ING
 * + Fideuram + Revolut alone. The hero was wrong, and "other accounts", derived
 * as `total − managed`, was garbage that could go negative.
 *
 * So the total is now built here, from the same per-account values the account
 * rows show. Everything in this file is pure: no I/O, no clock beyond an
 * injected `now`.
 */

import { fromCents, toCents } from "./money";
import { isStale } from "./staleness";
import { NET_WORTH_STALENESS_MS, type MonthPoint } from "@/lib/contracts";
import { monthKeyOf, monthRange } from "@/lib/time";

export interface NetWorthContributor {
  key: string;
  /** Raw Postgres numeric string, or null when the account has no known value. */
  balance: string | null;
  capturedAt: Date | null;
  points: readonly MonthPoint[];
}

export interface NetWorth {
  /** Numeric-string shaped like every other money value, or null. */
  balance: string | null;
  /** The summed monthly series — same definition as `balance`, so the hero
   *  number is the last point of its own chart. */
  points: MonthPoint[];
  /** Oldest capture among the accounts that actually contributed a value. */
  capturedAt: Date | null;
  stale: boolean;
  /** Keys that contributed a value, and keys that had none. Both are reported
   *  rather than silently folded into a zero. */
  contributing: string[];
  missing: string[];
}

export interface NetWorthOptions {
  now?: Date;
  /** Overridable only so tests can state the policy explicitly. */
  maxAgeMs?: number;
}

/**
 * A missing account contributes nothing — it is a gap, not a zero. But if NOT
 * ONE account has a value the answer is "unknown", never "0,00": a blank
 * dashboard must never look like a wiped-out net worth.
 */
export function sumBalances(contributors: readonly NetWorthContributor[]): string | null {
  let cents = 0;
  let any = false;
  for (const c of contributors) {
    const v = toCents(c.balance);
    if (v === null) continue;
    cents += v;
    any = true;
  }
  if (!any) return null;
  return (fromCents(cents) ?? 0).toFixed(2);
}

export function contributingKeys(contributors: readonly NetWorthContributor[]): string[] {
  return contributors.filter((c) => toCents(c.balance) !== null).map((c) => c.key);
}

export function missingKeys(contributors: readonly NetWorthContributor[]): string[] {
  return contributors.filter((c) => toCents(c.balance) === null).map((c) => c.key);
}

/** The oldest stamp among the accounts that contributed; null if none did. */
export function oldestCapture(contributors: readonly NetWorthContributor[]): Date | null {
  let oldest: Date | null = null;
  for (const c of contributors) {
    if (toCents(c.balance) === null) continue;
    if (c.capturedAt === null) continue;
    if (oldest === null || c.capturedAt.getTime() < oldest.getTime()) oldest = c.capturedAt;
  }
  return oldest;
}

interface Observed {
  byMonth: Map<string, number>;
}

/** Observed = non-null only. A blank Allocation cell is a gap the owner has not
 *  filled in yet, and averaging a 0 into it would be a lie. */
function observe(points: readonly MonthPoint[]): Observed | null {
  const byMonth = new Map<string, number>();
  for (const p of points) {
    const cents = toCents(p.value);
    if (cents === null) continue;
    byMonth.set(monthKeyOf(p.month), cents);
  }
  if (byMonth.size === 0) return null;
  return { byMonth };
}

/**
 * The summed series, with per-account carry-forward before the sum.
 *
 * Carry-forward is DISPLAY ONLY everywhere else in this codebase, and that
 * warning still stands — but a net-worth curve is exactly the case it was
 * written for. The owner refreshes EToro by hand every few months; without
 * carry-forward the curve would drop by the whole EToro balance in every month
 * he skipped and jump back up when he remembered, which describes his
 * bookkeeping habits rather than his wealth.
 *
 * The one thing carry-forward must never do is run BACKWARDS. An account is
 * absent — contributes nothing — for every month before its first observation,
 * because "we had not started tracking Binance yet" is not the same statement
 * as "Binance was worth what it is worth now". Forwards past an account's last
 * observation it does carry: a stale figure is still the best known figure.
 */
export function sumSeries(contributors: readonly NetWorthContributor[]): MonthPoint[] {
  const observed = contributors
    .map((c) => observe(c.points))
    .filter((o): o is Observed => o !== null);
  if (observed.length === 0) return [];

  const all = observed.flatMap((o) => [...o.byMonth.keys()]).sort();
  const first = all[0];
  const last = all[all.length - 1];
  if (first === undefined || last === undefined) return [];
  const axis = monthRange(first, last);

  const carried = observed.map(() => 0);
  const started = observed.map(() => false);

  return axis.map((month) => {
    let cents = 0;
    let any = false;
    observed.forEach((o, i) => {
      const value = o.byMonth.get(month);
      if (value !== undefined) {
        carried[i] = value;
        started[i] = true;
      }
      // Absent until this account's first observation: it contributes nothing.
      // Carry-forward must never run backwards.
      if (!started[i]) return;
      cents += carried[i] ?? 0;
      any = true;
    });
    return { month, value: any ? fromCents(cents) : null };
  });
}

/**
 * Staleness of a sum. Contributors age at wildly different rates — Wallet is
 * refreshed daily, a Teable-sourced figure can be months old in substance even
 * though the cache row is minutes old — so the total is judged against ONE
 * explicit budget (`NET_WORTH_STALENESS_MS`) applied to its oldest contributor.
 * Inheriting the strictest per-source budget instead would leave the hero
 * reading "stale" permanently, which trains the owner to ignore the badge.
 */
export function netWorth(
  contributors: readonly NetWorthContributor[],
  opts: NetWorthOptions = {},
): NetWorth {
  const now = opts.now ?? new Date();
  const maxAgeMs = opts.maxAgeMs ?? NET_WORTH_STALENESS_MS;
  const balance = sumBalances(contributors);
  const capturedAt = oldestCapture(contributors);

  return {
    balance,
    points: sumSeries(contributors),
    capturedAt,
    // Nothing known at all is stale by definition — `isStale(null)` is true.
    stale: balance === null || isStale(capturedAt, maxAgeMs, now),
    contributing: contributingKeys(contributors),
    missing: missingKeys(contributors),
  };
}
