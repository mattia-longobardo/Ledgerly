import { type CivilDate, type MonthKey } from "@/platform/dates";
import { type NumberFormat, type UiLocale, formatDate, formatMoney } from "@/platform/format";
import type { Cents } from "@/platform/money";

/** Line colours for the account charts, in order; an account's own colour wins when it has one. */
export const PALETTE = [
  "#2563eb",
  "#0e7490",
  "#047857",
  "#b45309",
  "#be123c",
  "#6d28d9",
  "#4d7c0f",
  "#0369a1",
] as const;

export function colorFor(account: { color: string | null }, index: number): string {
  return account.color ?? PALETTE[index % PALETTE.length];
}

export interface Change {
  cents: Cents | null;
  /** The change as a fraction of the earlier value; `null` when there is nothing to compare to. */
  fraction: number | null;
}

/** What changed between two known values. Either one unknown makes the change unknown, not zero. */
export function changeBetween(current: Cents | null, earlier: Cents | null): Change {
  if (current === null || earlier === null) return { cents: null, fraction: null };
  const cents = current - earlier;
  return { cents, fraction: earlier === 0n ? null : Number(cents) / Math.abs(Number(earlier)) };
}

/** An account's share of a total; `null` rather than a misleading 0 % when either is unknown. */
export function shareOf(value: Cents | null, total: Cents | null): number | null {
  if (value === null || total === null || total === 0n) return null;
  return Number(value) / Number(total);
}

/** Cents as plain numbers for the charts, which measure distances rather than money. */
export function asNumbers(values: readonly (Cents | null)[]): (number | null)[] {
  return values.map((value) => (value === null ? null : Number(value)));
}

/** Four horizontal grid labels, top to bottom, over the range a series actually covers. */
export function axisLabels(values: readonly (Cents | null)[], format: NumberFormat, steps = 4): string[] {
  const known = values.filter((value): value is Cents => value !== null).map(Number);
  const high = known.length === 0 ? 0 : Math.max(...known, 0);
  const low = known.length === 0 ? 0 : Math.min(...known, 0);
  return Array.from({ length: steps }, (_, index) => {
    const value = high - ((high - low) * index) / (steps - 1);
    return formatMoney(BigInt(Math.round(value)), format, { decimals: false });
  });
}

/**
 * The labels of a chart whose zero is its middle line — the changes drawn as bars around it —
 * from the largest change at the top to its opposite at the bottom, zero in the middle. The plain
 * `axisLabels` runs from the highest to the lowest value, which put a figure like "2.600 €" on the
 * bars' baseline.
 */
export function symmetricAxisLabels(values: readonly (Cents | null)[], format: NumberFormat): string[] {
  const reach = values.reduce<Cents>((largest, value) => {
    if (value === null) return largest;
    const size = value < 0n ? -value : value;
    return size > largest ? size : largest;
  }, 0n);
  return axisLabels([reach, -reach], format, 5);
}

/** At most `count` month labels, evenly spread, always including the first and the last. */
export function monthLabels(months: readonly MonthKey[], locale: UiLocale, count = 5): string[] {
  if (months.length <= count) return months.map((month) => formatDate(month, "monthShort", locale));
  const step = (months.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, index) =>
    formatDate(months[Math.round(index * step)], "monthShort", locale),
  );
}

/** At most `count` day labels, evenly spread, always including the first and the last (F2.5). */
export function dayLabels(days: readonly CivilDate[], locale: UiLocale, count = 5): string[] {
  if (days.length <= count) return days.map((day) => formatDate(day, "dayMonth", locale));
  const step = (days.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, index) =>
    formatDate(days[Math.round(index * step)], "dayMonth", locale),
  );
}

export type Since = { unit: "never" } | { unit: "minutes" | "hours" | "days"; count: number };

/** How long ago an instant was, in the coarse steps the design's "Last synced" column uses. */
export function since(instant: Date | null, now: Date): Since {
  if (instant === null) return { unit: "never" };
  const minutes = Math.max(0, Math.round((now.getTime() - instant.getTime()) / 60_000));
  if (minutes < 60) return { unit: "minutes", count: minutes };
  const hours = Math.round(minutes / 60);
  if (hours < 48) return { unit: "hours", count: hours };
  return { unit: "days", count: Math.round(hours / 24) };
}
