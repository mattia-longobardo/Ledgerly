"use client";

import { useTranslations } from "use-intl";
import { formatDate, type UiLocale } from "@ledgerly/format/format";
import { type DateRange, daysInRange } from "@ledgerly/format/ranges";
import { DateRangePicker } from "./date-range-picker";
import type { Params } from "./url";

/**
 * Expenses' date range control: the design system's `DateRangePicker` at day grain, with the words
 * of this screen. The picker itself draws Overview and Account detail at month grain too, with
 * the words its caller gives; this control gives Expenses' own.
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
  const words = useTranslations("expenses.filters.range");
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
        from: words("from"),
        to: words("to"),
        previous: words("previousMonth"),
        next: words("nextMonth"),
        pickEnd: words("pickEnd"),
        apply: words("apply"),
        cancel: words("cancel"),
      }}
      describe={(from, to) =>
        words("hint", {
          from: formatDate(from, "long", locale),
          to: formatDate(to, "long", locale),
          count: daysInRange({ from, to }),
        })
      }
    />
  );
}
