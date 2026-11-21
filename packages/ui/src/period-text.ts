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
  /** The days the control shows: the period's, from the first day with data (the server's `span`). */
  span: { from: CivilDate; to: CivilDate };
}

type PeriodWords = (
  key: "yearToDate" | "since" | "between",
  values: Record<string, string | number>,
) => string;

export function answeredPeriodText(
  period: AnsweredPeriod,
  todayOn: CivilDate,
  locale: UiLocale,
  words: PeriodWords,
): string {
  const { span } = period;
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
