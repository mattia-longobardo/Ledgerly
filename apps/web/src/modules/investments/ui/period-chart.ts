// The words and labels of a period's chart (docs/design/investments-ux.md §2.2, §7), shared by the home
// and a service's Overview: the name of a bar, the sampled labels under the axis, the value days.
// Formatting of the server's intervals only.
import { formatDate, type UiLocale } from "@ledgerly/format/format";
import { sampled } from "@ledgerly/ui/chart-data";
import { dayLabels } from "@ledgerly/ui/chart-labels";

interface Chart {
  barGrain: "week" | "month" | "year";
  intervals: readonly { from: string; to: string }[];
  valueGrain: "day" | "month";
  valueDays: readonly string[];
}

/** A bar in words: its year, its month, or its week's days. */
export function intervalName(chart: Chart, index: number, locale: UiLocale): string {
  const interval = chart.intervals[index];
  if (chart.barGrain === "year") return interval.from.slice(0, 4);
  if (chart.barGrain === "month") return formatDate(interval.from, "monthYear", locale);
  return `${formatDate(interval.from, "dayMonth", locale)} – ${formatDate(interval.to, "dayMonth", locale)}`;
}

/** At most five labels under the bars. */
export function barLabels(chart: Chart, locale: UiLocale): string[] {
  return sampled(chart.intervals.length).map((index) => {
    const from = chart.intervals[index].from;
    if (chart.barGrain === "year") return from.slice(0, 4);
    return formatDate(from, chart.barGrain === "month" ? "monthShort" : "dayMonth", locale);
  });
}

/** The labels under the value's area: days, or month ends. */
export function valueLabels(chart: Chart, locale: UiLocale): string[] {
  return chart.valueGrain === "day"
    ? dayLabels(chart.valueDays, locale)
    : sampled(chart.valueDays.length).map((index) =>
        formatDate(chart.valueDays[index], "monthShort", locale),
      );
}
