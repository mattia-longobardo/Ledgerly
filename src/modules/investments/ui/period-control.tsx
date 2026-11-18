import type { useTranslations } from "next-intl";
import type { PnlPeriod } from "@ledgerly/domain/investments/client";
import type { CivilDate } from "@ledgerly/domain/platform/dates";
import { formatDate, type UiLocale } from "@ledgerly/domain/platform/format";

/** The words of the period: the server's `getTranslations` or the client's `useTranslations`. */
export type PeriodT = ReturnType<typeof useTranslations<"investments.period">>;
type T = PeriodT;

/** The period in words (§2.1): "2026 · year to date", "2025", "since 28 Oct 2024", or the days. */
export function periodText(
  period: PnlPeriod,
  span: { from: CivilDate; to: CivilDate },
  todayOn: CivilDate,
  locale: UiLocale,
  t: T,
): string {
  if (period.kind === "year") {
    return period.year === Number(todayOn.slice(0, 4))
      ? t("yearToDate", { year: period.year })
      : String(period.year);
  }
  if (period.kind === "all") return t("since", { date: formatDate(span.from, "long", locale) });
  return t("range", { from: formatDate(span.from, "long", locale), to: formatDate(span.to, "long", locale) });
}
