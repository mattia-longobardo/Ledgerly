/**
 * The chart range of Overview and Account detail, read from the address (spec §7.1, F2.5): two
 * `AAAA-MM` ends, as the month-grain `DateRangePicker` writes them. Pure, so both pages read the
 * address the same way and the rule is tested once.
 */

import { type MonthKey, monthsBetween } from "@/platform/dates";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function monthOf(value: unknown): MonthKey | null {
  return typeof value === "string" && MONTH.test(value) ? `${value}-01` : null;
}

/**
 * The range the address asks for, or `null` when it asks for none — then the page's preset wins.
 * An end in the future is brought back to the current month: the series stop at today, and a
 * window reaching past it would draw months that have not happened. A range entirely in the future
 * is no range at all.
 */
export function monthRange(
  raw: { from?: unknown; to?: unknown },
  thisMonth: MonthKey,
): { from: MonthKey; to: MonthKey; months: number } | null {
  const from = monthOf(raw.from);
  const wanted = monthOf(raw.to);
  if (from === null || wanted === null || wanted < from || from > thisMonth) return null;
  const to = wanted > thisMonth ? thisMonth : wanted;
  return { from, to, months: monthsBetween(from, to).length };
}
