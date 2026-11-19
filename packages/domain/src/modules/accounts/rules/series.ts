// The balances of an account over time and their totals (spec §7.1, F2.5): month ends, days,
// the net worth, the alerts. Part of `rules`; pure.
import {
  addMonths,
  type CivilDate,
  lastDayOfMonth,
  type MonthKey,
  monthKey,
  monthsApart,
} from "../../../shared/dates";
import { type Cents, divRound, sumCents } from "../../../shared/money";
import { type AccountOrigin, type AccountState, isStale, type Trend } from "./index";

export interface BalancePoint {
  on: CivilDate;
  cents: Cents;
  /** Rebuilt from the movements rather than read (F2.5): the charts draw it dashed. */
  derived?: boolean;
}

/** One day's net of an account's movements, as `dailyNetByAccount` gives it. */
interface DailyNet {
  on: CivilDate;
  cents: Cents;
}

/**
 * The month ends of a synced account rebuilt from its movements (spec §7.1, F2.5).
 *
 * A month that holds **any** reading gets nothing: `monthlyPoints` takes a month's latest day
 * before its source, so a derived point on the 31st would beat a real reading of the 20th. Every
 * other month end between the month before the first movement and the latest reading gets the
 * nearest reading **after** it, minus what moved in between — so a gap between two readings is
 * filled too, and each value leans on the closest thing actually known. Before the month of the
 * first movement nothing is known about the history, and nothing is written.
 *
 * `observed` must hold one reading per day at most (the best source of that day); `daily` is sorted
 * by day. A day's movements count up to and including the reading of that day, which is how a
 * balance read today already contains today's movements.
 */
export function deriveMonthEnds(
  observed: readonly BalancePoint[],
  daily: readonly DailyNet[],
): BalancePoint[] {
  if (observed.length === 0 || daily.length === 0) return [];
  const readings = [...observed].sort(byDay);
  const readMonths = new Set(readings.map((reading) => monthKey(reading.on)));
  const latest = readings[readings.length - 1].on;

  const movedThrough = movementsThrough(daily);

  const derived: BalancePoint[] = [];
  for (
    let month = addMonths(monthKey(daily[0].on), -1);
    lastDayOfMonth(month) < latest;
    month = addMonths(month, 1)
  ) {
    if (readMonths.has(month)) continue;
    const end = lastDayOfMonth(month);
    const next = readings.find((reading) => reading.on > end);
    if (!next) break;
    derived.push({ on: end, cents: next.cents - (movedThrough(next.on) - movedThrough(end)), derived: true });
  }
  return derived;
}

/**
 * Everything an account moved on or before a day, from its daily nets (sorted by day): prefix sums
 * and a binary search, so "what moved in (a, b]" is one subtraction whatever the history's length.
 */
function movementsThrough(daily: readonly DailyNet[]): (on: CivilDate) => Cents {
  const cumulative: Cents[] = [];
  let running = 0n;
  for (const day of daily) {
    running += day.cents;
    cumulative.push(running);
  }
  return (day) => {
    let low = 0;
    let high = daily.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (daily[middle].on <= day) low = middle + 1;
      else high = middle;
    }
    return low === 0 ? 0n : cumulative[low - 1];
  };
}

/**
 * An account's balance on each of `days` (F2.5), for Account detail's day grain.
 *
 * `movements` (a synced account): the nearest reading on or after the day, minus what moved in
 * between — so a reading, or a correction typed by hand, is never walked over — and past the latest
 * reading, that reading plus what moved since. Days before the first reading are rebuilt and flagged
 * `estimated`, like the month ends of `deriveMonthEnds`, and nothing is rebuilt before the month the
 * first movement falls in. `hold` (a manual account, or one with no movements): the last entry
 * carries until the next, and a day before the first one is unknown.
 *
 * `readings` holds one value per day at most; `daily` is sorted by day.
 */
export function dailySeries(
  readings: readonly BalancePoint[],
  daily: readonly DailyNet[],
  days: readonly CivilDate[],
  mode: "movements" | "hold",
): { values: (Cents | null)[]; estimated: boolean[] } {
  const sorted = [...readings].sort(byDay);
  const held = (day: CivilDate): Cents | null => {
    let value: Cents | null = null;
    for (const reading of sorted) {
      if (reading.on > day) break;
      value = reading.cents;
    }
    return value;
  };
  if (mode === "hold" || daily.length === 0 || sorted.length === 0) {
    return { values: days.map(held), estimated: days.map(() => false) };
  }

  const movedThrough = movementsThrough(daily);
  const earliest = lastDayOfMonth(addMonths(monthKey(daily[0].on), -1));
  const first = sorted[0];
  const latest = sorted[sorted.length - 1];
  const values = days.map((day) => {
    if (day < earliest) return held(day);
    const next = sorted.find((reading) => reading.on >= day);
    if (next) return next.cents - (movedThrough(next.on) - movedThrough(day));
    return latest.cents + (movedThrough(day) - movedThrough(latest.on));
  });
  return { values, estimated: days.map((day, index) => values[index] !== null && day < first.on) };
}

/**
 * Which months of a chart stand on a derived point (F2.5), with the same carrying forward as
 * `monthEndSeries`: a month takes the flag of the point its value comes from. A month before the
 * first point is a gap in the series, and a gap is not an estimate.
 */
export function estimatedMonths(points: readonly BalancePoint[], months: readonly MonthKey[]): boolean[] {
  if (months.length === 0) return [];
  const first = months[0];
  const anchors = new Map<number, boolean>();
  for (const point of points) anchors.set(monthsApart(first, monthKey(point.on)), point.derived === true);
  const indexes = [...anchors.keys()].sort((left, right) => left - right);
  return months.map((_month, position) => {
    let previous: number | null = null;
    for (const index of indexes) {
      if (index <= position) previous = index;
      else break;
    }
    return previous === null ? false : (anchors.get(previous) ?? false);
  });
}

function roundedBetween(from: Cents, to: Cents, step: number, span: number): Cents {
  return from + divRound((to - from) * BigInt(step), BigInt(span));
}

/**
 * One value per month, each the account's last balance on or before that month's end.
 *
 * `points` must be sorted by date and may start before the window: the most recent earlier point
 * is the series' starting value (spec §7.1). A month before the very first point is `null`, never
 * zero. `hold` carries the last known value forward; `interpolate` draws a straight line between
 * two known months and is for charts only — totals always use `hold`.
 */
export function monthEndSeries(
  points: readonly BalancePoint[],
  months: readonly MonthKey[],
  trend: Trend = "hold",
): (Cents | null)[] {
  if (months.length === 0) return [];
  const first = months[0];
  const anchors = new Map<number, Cents>();
  for (const point of points) {
    anchors.set(monthsApart(first, monthKey(point.on)), point.cents);
  }
  const indexes = [...anchors.keys()].sort((left, right) => left - right);

  return months.map((_month, position) => {
    let previous: number | null = null;
    let next: number | null = null;
    for (const index of indexes) {
      if (index <= position) previous = index;
      else {
        next = index;
        break;
      }
    }
    // Both are keys of `anchors`, read from it just above.
    const from = previous === null ? undefined : anchors.get(previous);
    if (previous === null || from === undefined) return null;
    const to = next === null ? undefined : anchors.get(next);
    if (trend === "hold" || next === null || to === undefined || previous === position) return from;
    return roundedBetween(from, to, position - previous, next - previous);
  });
}

/**
 * The monthly total across accounts. A month is `null` only when every account is unknown there;
 * `partial` marks a total that is missing at least one account, so it is never shown as complete.
 */
export function totalSeries(
  series: readonly (readonly (Cents | null)[])[],
  length: number,
): { total: Cents | null; partial: boolean }[] {
  return Array.from({ length }, (_value, index) => sumCents(series.map((one) => one[index] ?? null)));
}

/** Which accounts a total counts (decision D2): «in the net worth», or «in the snapshot». */
export type TotalOf = "inNetWorth" | "inSnapshot";

/**
 * The one total of the accounts (ACC-1, ACC-3): the open accounts the filter names, each value
 * already in the display currency, summed; partial when a value is unknown. The net worth of
 * Overview, its buckets and the monthly snapshot are this sum, with their own filter.
 */
export function netWorth(
  values: readonly {
    account: { inNetWorth: boolean; inSnapshot: boolean; state: string };
    cents: Cents | null;
  }[],
  filter: TotalOf,
): { total: Cents | null; partial: boolean } {
  return sumCents(
    values
      .filter((value) => value.account[filter] && value.account.state !== "archived")
      .map((value) => value.cents),
  );
}

type AlertKind = "low_balance" | "stale_sync";

export interface AccountAlert {
  accountId: string;
  kind: AlertKind;
}

/**
 * The two account alerts of spec §7.1, each governed by that account's own settings. An archived
 * account is silent, and an account with no balance yet cannot be below its threshold.
 */
export function alertsFor(
  account: {
    id: string;
    state: AccountState;
    origin: AccountOrigin;
    lowBalanceCents: Cents | null;
    staleAfterHours: number;
    lastSyncedAt: Date | null;
  },
  latest: Cents | null,
  now: Date,
): AccountAlert[] {
  if (account.state === "archived") return [];
  const alerts: AccountAlert[] = [];
  if (account.lowBalanceCents !== null && latest !== null && latest < account.lowBalanceCents) {
    alerts.push({ accountId: account.id, kind: "low_balance" });
  }
  // Not for an `unavailable` account: the provider has stopped returning it, so of course its
  // reading is old, and §7.1 forbids deleting it — the alert would never clear and says nothing
  // the state does not already say. "Stale" is for an account the provider still has and is not
  // sending.
  if (
    account.origin === "synced" &&
    account.state !== "unavailable" &&
    isStale(account.lastSyncedAt, account.staleAfterHours, now)
  ) {
    alerts.push({ accountId: account.id, kind: "stale_sync" });
  }
  return alerts;
}

/** Oldest first, by the civil date of each point. */
export function byDay<T extends { on: CivilDate }>(left: T, right: T): number {
  return left.on < right.on ? -1 : left.on > right.on ? 1 : 0;
}
