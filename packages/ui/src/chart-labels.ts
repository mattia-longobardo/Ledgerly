// The labels and values of a chart's axes (audit ACC-11): generic, so every chart of every module
// draws them from here rather than from the accounts' own helpers.
import type { Cents } from "@ledgerly/format/cents";
import type { CivilDate, MonthKey } from "@ledgerly/format/dates";
import { formatDate, formatMoney, type NumberFormat, type UiLocale } from "@ledgerly/format/format";

/** Cents as plain numbers for the charts, which measure distances rather than money. */
export function asNumbers(values: readonly (Cents | null)[]): (number | null)[] {
  return values.map((value) => (value === null ? null : Number(value)));
}

/** Four horizontal grid labels, top to bottom, over the range a series actually covers. */
export function axisLabels(
  values: readonly (Cents | null)[],
  format: NumberFormat,
  steps = 4,
  currency = "EUR",
): string[] {
  const known = values.filter((value): value is Cents => value !== null).map(Number);
  const high = known.length === 0 ? 0 : Math.max(...known, 0);
  const low = known.length === 0 ? 0 : Math.min(...known, 0);
  return Array.from({ length: steps }, (_slot, index) => {
    const value = high - ((high - low) * index) / (steps - 1);
    return formatMoney(BigInt(Math.round(value)), format, { decimals: false, currency });
  });
}

/**
 * The labels of a chart whose zero is its middle line — the changes drawn as bars around it —
 * from the largest change at the top to its opposite at the bottom, zero in the middle. The plain
 * `axisLabels` runs from the highest to the lowest value, which put a figure like "2.600 €" on the
 * bars' baseline.
 */
export function symmetricAxisLabels(
  values: readonly (Cents | null)[],
  format: NumberFormat,
  currency = "EUR",
): string[] {
  const reach = values.reduce<Cents>((largest, value) => {
    if (value === null) return largest;
    const size = value < 0n ? -value : value;
    return size > largest ? size : largest;
  }, 0n);
  return axisLabels([reach, -reach], format, 5, currency);
}

/** At most `count` month labels, evenly spread, always including the first and the last. */
export function monthLabels(months: readonly MonthKey[], locale: UiLocale, count = 5): string[] {
  if (months.length <= count) return months.map((month) => formatDate(month, "monthShort", locale));
  const step = (months.length - 1) / (count - 1);
  return Array.from({ length: count }, (_slot, index) =>
    formatDate(months[Math.round(index * step)], "monthShort", locale),
  );
}

/** At most `count` day labels, evenly spread, always including the first and the last (F2.5). */
export function dayLabels(days: readonly CivilDate[], locale: UiLocale, count = 5): string[] {
  if (days.length <= count) return days.map((day) => formatDate(day, "dayMonth", locale));
  const step = (days.length - 1) / (count - 1);
  return Array.from({ length: count }, (_slot, index) =>
    formatDate(days[Math.round(index * step)], "dayMonth", locale),
  );
}
