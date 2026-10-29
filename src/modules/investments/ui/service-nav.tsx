"use client";

import type { Route } from "next";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { periodSpan } from "@/modules/investments/period";
import { periodOf } from "@/modules/investments/pnl";
import type { CivilDate } from "@/platform/dates";
import type { UiLocale } from "@/platform/format";
import { TabLinks } from "@/ui/tab-links";
import { type Params, withParams } from "@/ui/url";
import { PeriodControl } from "./period-control";

/** The parameters of the period (§1.2): the only ones a tab carries to the next. */
const PERIOD_KEYS = ["period", "from", "to"] as const;

export type ServiceTab = { key: string; href: string; label: string; badge?: ReactNode };

function usePeriodParams(): Params {
  const search = useSearchParams();
  return Object.fromEntries(PERIOD_KEYS.map((key) => [key, search.get(key) ?? undefined]));
}

/**
 * The tabs of a service (docs/design/investments-ux.md §1.1, §3.2): routes, not client state, so the
 * back button walks them; each link keeps the period of the address, and nothing else.
 */
export function ServiceTabs({ label, tabs }: { label: string; tabs: ServiceTab[] }) {
  const pathname = usePathname();
  const period = usePeriodParams();
  return (
    <TabLinks
      label={label}
      tabs={tabs.map((tab) => ({
        href: withParams(tab.href, {}, period),
        label: tab.badge ? (
          <span className="inline-flex items-center gap-1.5">
            {tab.label}
            {tab.badge}
          </span>
        ) : (
          tab.label
        ),
        active: pathname === tab.href,
      }))}
    />
  );
}

/** The topbar title under the "Investments" crumb: the service, and the open tab past the first. */
export function ServiceCrumb({ name, tabs }: { name: string; tabs: ServiceTab[] }) {
  const pathname = usePathname();
  const open = tabs.findIndex((tab) => tab.href === pathname);
  return open <= 0 ? name : `${name} / ${tabs[open].label}`;
}

/**
 * The period of a service (§3.2), drawn once by its layout. A layout never receives the search
 * parameters, so the control reads them here, on the client, with the same rules as the server
 * (`periodOf`, `periodSpan`): the page below and this control always agree on the period.
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
  const t = useTranslations("investments.period");
  const pathname = usePathname();
  const search = useSearchParams();
  if (hiddenOn.includes(pathname)) return null;
  const period = periodOf(
    { period: search.get("period"), from: search.get("from"), to: search.get("to") },
    todayOn,
  );
  // The tab's own parameters ride along but the page: a new period starts on the first page.
  const params: Params = {};
  for (const [key, value] of search.entries()) {
    if (!(PERIOD_KEYS as readonly string[]).includes(key) && key !== "p") params[key] = value;
  }
  return (
    <PeriodControl
      period={period}
      span={periodSpan(period, firstOn)}
      todayOn={todayOn}
      firstOn={firstOn}
      path={pathname as Route}
      params={params}
      locale={locale}
      t={t}
    />
  );
}
