"use client";

import { useTranslations } from "next-intl";
import { lastDayOfMonth, type MonthKey, monthsBetween } from "@/platform/dates";
import { formatDate, type UiLocale } from "@/platform/format";
import { DateRangePicker } from "@/ui/date-range-picker";
import type { Params } from "@/ui/url";

/**
 * The chart range of Overview and Account detail (spec §7.1, F2.5): the design system's
 * `DateRangePicker` at month grain, because both series are one point per month. It shows the
 * window the chart is drawing, preset or not, so the control always says what is on screen.
 */
export function MonthRangePicker({
  from,
  to,
  path,
  params,
  locale,
}: {
  /** The first and the last month of the chart's window. */
  from: MonthKey;
  to: MonthKey;
  path: string;
  /** Everything the page carries except the period: a chosen range replaces the preset. */
  params: Params;
  locale: UiLocale;
}) {
  const t = useTranslations("accounts.range");
  const text =
    from === to
      ? formatDate(from, "monthYear", locale)
      : `${formatDate(from, "monthShort", locale)} – ${formatDate(to, "monthShort", locale)}`;
  return (
    <DateRangePicker
      grain="month"
      // At the right of its card's header in both Overview and Account detail.
      align="end"
      range={{ from, to: lastDayOfMonth(to) }}
      text={text}
      path={path}
      params={params}
      locale={locale}
      labels={{
        label: t("label"),
        from: t("from"),
        to: t("to"),
        previous: t("previousYear"),
        next: t("nextYear"),
        pickEnd: t("pickEnd"),
        apply: t("apply"),
        cancel: t("cancel"),
      }}
      describe={(first, last) =>
        t("hint", {
          from: formatDate(first, "monthYear", locale),
          to: formatDate(last, "monthYear", locale),
          count: monthsBetween(first, last).length,
        })
      }
    />
  );
}
