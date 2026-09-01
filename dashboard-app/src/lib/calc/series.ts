import type { MonthPoint, Series } from "@/lib/contracts";
import { addMonths, monthKey, monthKeyOf, monthRange } from "@/lib/time";
import { fromCents, toCents } from "./money";

export type SeriesLike = readonly MonthPoint[] | Series;

export type RangePreset = "1M" | "3M" | "6M" | "12M" | "YTD" | "ALL";

export interface CustomRange {
  from: string;
  to: string;
}

export type RangeSpec = RangePreset | CustomRange | readonly string[];

export interface RangeOptions {
  now?: Date;
  /** Required for "ALL": the first month that exists in the data. */
  earliest?: string | null;
}

export function pointsOf(series: SeriesLike): readonly MonthPoint[] {
  return Array.isArray(series) ? series : (series as Series).points;
}

function sortedUniqueMonths(months: readonly string[]): string[] {
  return [...new Set(months.map(monthKeyOf))].sort();
}

/**
 * Presets are inclusive windows ending at the current month: "3M" is three
 * month keys, not four. Delta baselines are handled by deltaOverRange.
 */
export function rangeToMonths(range: RangeSpec, opts: RangeOptions = {}): string[] {
  if (Array.isArray(range)) return sortedUniqueMonths(range as readonly string[]);
  if (typeof range === "object") {
    const custom = range as CustomRange;
    return monthRange(monthKeyOf(custom.from), monthKeyOf(custom.to));
  }
  const to = monthKey(opts.now ?? new Date());
  if (range === "ALL") {
    const earliest = opts.earliest;
    return earliest ? monthRange(monthKeyOf(earliest), to) : [];
  }
  if (range === "YTD") return monthRange(`${to.slice(0, 4)}-01-01`, to);
  const span = Number(range.replace("M", ""));
  return monthRange(addMonths(to, -(span - 1)), to);
}

/** DISPLAY ONLY: invents values for months that were never observed. Never feed
 * the result back into returns, averages or any stored figure. */
export function carryForward(points: SeriesLike): MonthPoint[] {
  const src = pointsOf(points);
  if (src.length === 0) return [];
  const byMonth = new Map<string, number | null>();
  for (const p of src) byMonth.set(monthKeyOf(p.month), p.value);
  const months = [...byMonth.keys()].sort();
  const first = months[0];
  const last = months[months.length - 1];
  if (first === undefined || last === undefined) return [];
  let carried: number | null = null;
  return monthRange(first, last).map((month) => {
    const v = byMonth.get(month);
    if (v !== undefined && v !== null) carried = v;
    return { month, value: carried };
  });
}

/** Every series gets the same continuous month axis; absent months stay null. */
export function alignSeries(list: readonly Series[]): Series[] {
  const all: string[] = [];
  for (const s of list) for (const p of s.points) all.push(monthKeyOf(p.month));
  const months = sortedUniqueMonths(all);
  const first = months[0];
  const last = months[months.length - 1];
  const axis = first === undefined || last === undefined ? [] : monthRange(first, last);
  return list.map((s) => {
    const byMonth = new Map<string, number | null>();
    for (const p of s.points) byMonth.set(monthKeyOf(p.month), p.value);
    return {
      key: s.key,
      label: s.label,
      points: axis.map((month) => ({ month, value: byMonth.get(month) ?? null })),
    };
  });
}

export interface Delta {
  abs: number | null;
  /** Percentage points, e.g. 4.2 for +4.2 % — matches formatPercent. */
  pct: number | null;
}

/**
 * Latest observed value versus the last observed value at or before
 * `months` back. Both ends must exist, otherwise the badge shows nothing.
 */
export function deltaOverRange(points: SeriesLike, months: number): Delta {
  const observed = pointsOf(points)
    .filter((p) => p.value !== null)
    .map((p) => ({ month: monthKeyOf(p.month), cents: toCents(p.value) }))
    .filter((p): p is { month: string; cents: number } => p.cents !== null)
    .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));

  const end = observed[observed.length - 1];
  if (!end) return { abs: null, pct: null };
  const baseMonth = addMonths(end.month, -months);
  let base: { month: string; cents: number } | undefined;
  for (const p of observed) {
    if (p.month <= baseMonth) base = p;
  }
  if (!base || base.month === end.month) return { abs: null, pct: null };
  const absCents = end.cents - base.cents;
  return {
    abs: fromCents(absCents),
    pct: base.cents === 0 ? null : (absCents / base.cents) * 100,
  };
}
