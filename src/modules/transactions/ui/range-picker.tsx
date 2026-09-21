"use client";

import { useTranslations } from "next-intl";
import { formatDate, type UiLocale } from "@/platform/format";
import { DateRangePicker } from "@/ui/date-range-picker";
import type { Params } from "@/ui/url";
import { type DateRange, daysInRange } from "./filters";

/**
 * Expenses' date range control: the design system's `DateRangePicker` at day grain, with the words
 * of this screen. The picker itself lives in `src/ui` since F2.5, where Overview and Account detail
 * use it too at month grain; `src/ui` knows no message catalogue, so the translation happens here.
 */
export function RangePicker({
  range,
  text,
  params,
  locale,
  label,
  path = "/expenses",
}: {
  range: DateRange;
  /** The range spelled out: this control is the period label of the stepper it sits in. */
  text: string;
  /** The parameters to carry over: everything except the period, which this control replaces. */
  params: Params;
  locale: UiLocale;
  /** The control's own name, as its tooltip: the visible text is the range itself. */
  label: string;
  path?: string;
}) {
  const t = useTranslations("expenses.filters.range");
  return (
    <DateRangePicker
      grain="day"
      range={range}
      text={text}
      path={path}
      params={params}
      locale={locale}
      labels={{
        label,
        from: t("from"),
        to: t("to"),
        previous: t("previousMonth"),
        next: t("nextMonth"),
        pickEnd: t("pickEnd"),
        apply: t("apply"),
        cancel: t("cancel"),
      }}
      describe={(from, to) =>
        t("hint", {
          from: formatDate(from, "long", locale),
          to: formatDate(to, "long", locale),
          count: daysInRange({ from, to }),
        })
      }
    />
  );
}
