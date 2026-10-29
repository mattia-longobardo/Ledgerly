"use client";

import { useTranslations } from "next-intl";
import { type CivilDate, daysBetween } from "@/platform/dates";
import { formatDate, type UiLocale } from "@/platform/format";
import { DateRangePicker } from "@/ui/date-range-picker";
import type { Params } from "@/ui/url";

/**
 * "Custom" of the Investments period (docs/design/investments-ux.md §2.1): the design system's
 * `DateRangePicker` by day, with the shortcuts of the design and the words of this section. The
 * translation happens here because `src/ui` knows no message catalogue.
 */
export function PeriodPicker({
  range,
  text,
  path,
  params,
  locale,
  shortcuts,
}: {
  range: { from: CivilDate; to: CivilDate };
  text: string;
  path: string;
  /** Everything but the period, which this control replaces. */
  params: Params;
  locale: UiLocale;
  shortcuts: { label: string; href: string; current?: boolean }[];
}) {
  const t = useTranslations("investments.period");
  return (
    <DateRangePicker
      grain="day"
      align="end"
      range={range}
      text={text}
      path={path}
      params={params}
      locale={locale}
      shortcuts={shortcuts}
      labels={{
        label: t("pick"),
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
          count: daysBetween(from, to) + 1,
        })
      }
    />
  );
}
