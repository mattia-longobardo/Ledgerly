"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { PeriodBarView } from "@/modules/accounts/ui/period-bar";
import { PERIOD_KEYS, periodSpan, SECTION_PRESETS, sectionPeriod } from "@ledgerly/domain/investments/client";
import { periodText } from "@/modules/investments/ui/period-control";
import type { CivilDate } from "@ledgerly/domain/platform/dates";
import type { UiLocale } from "@ledgerly/domain/platform/format";
import type { Params } from "@/ui/url";

/**
 * The period of a service (docs/design/investments-ux.md §3.2), drawn once by its layout. A layout
 * never receives the search parameters, so the control reads them here, on the client, with the
 * same rules as the server (`sectionPeriod`, `periodSpan`): the page below and this control always
 * agree on the period.
 */
export function ServicePeriodControl({
  todayOn,
  firstOn,
  locale,
  hiddenOn,
}: {
  todayOn: CivilDate;
  firstOn: CivilDate | null;
  locale: UiLocale;
  /** The tabs that are always "today" (Connection, §2.3): no period to pick there. */
  hiddenOn: string[];
}) {
  const t = useTranslations("expenses.filters");
  const tp = useTranslations("investments.period");
  const pathname = usePathname();
  const search = useSearchParams();
  if (hiddenOn.includes(pathname)) return null;
  const section = sectionPeriod(Object.fromEntries(search.entries()), todayOn);
  const span = periodSpan(section.period, firstOn);
  const text = periodText(section.period, span, todayOn, locale, tp);
  // The tab's own parameters ride along but the page: a new period starts on the first page.
  const carry: Params = {};
  for (const [key, value] of search.entries()) {
    if (!(PERIOD_KEYS as readonly string[]).includes(key) && key !== "p") carry[key] = value;
  }
  return (
    <PeriodBarView
      period={section}
      path={pathname}
      carry={carry}
      locale={locale}
      t={t}
      presets={SECTION_PRESETS}
      name={section.period.kind === "year" ? text : undefined}
      whole={{ range: span, text }}
    />
  );
}
