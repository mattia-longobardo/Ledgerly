// The period of Funds in words and its days on the control (funds-ux §6), from the period the server
// answered (`period` of `GET /funds` and of a fund's tabs): "2026 · year to date", "2025", "since
// 28 Oct 2024", or the days. Formatting only: the dates are the server's.
import { type CivilDate } from "@ledgerly/format/dates";
import { formatDate, type UiLocale } from "@ledgerly/format/format";

export interface AnsweredPeriod {
  kind: "year" | "all" | "custom";
  year: number | null;
  from: CivilDate | null;
  to: CivilDate;
  firstOn: CivilDate | null;
}

type PeriodWords = (
  key: "yearToDate" | "since" | "between",
  values: Record<string, string | number>,
) => string;

/**
 * The days the control shows: the period's, starting no earlier than the first day with data (a custom
 * period keeps its own start). shortcut: a clamp of the server's two dates; a `span` field in the
 * answer would replace it.
 */
export function answeredSpan(period: AnsweredPeriod): { from: CivilDate; to: CivilDate } {
  const { firstOn, to } = period;
  const start = period.from ?? firstOn ?? to;
  const from = period.kind === "custom" || firstOn === null || start >= firstOn ? start : firstOn;
  return { from: from > to ? to : from, to };
}

export function answeredPeriodText(
  period: AnsweredPeriod,
  todayOn: CivilDate,
  locale: UiLocale,
  words: PeriodWords,
): string {
  const span = answeredSpan(period);
  if (period.kind === "year" && period.year !== null) {
    return period.year === Number(todayOn.slice(0, 4))
      ? words("yearToDate", { year: period.year })
      : String(period.year);
  }
  if (period.kind === "all") return words("since", { date: formatDate(span.from, "long", locale) });
  return words("between", {
    from: formatDate(span.from, "long", locale),
    to: formatDate(span.to, "long", locale),
  });
}
