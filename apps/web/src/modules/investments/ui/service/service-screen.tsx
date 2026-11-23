"use client";

// A service (docs/design/investments-ux.md §1.1, §3.2, U3), read from `/api/v1` (rewrite plan R3): its
// header, the tabs as routes, the period drawn once for every tab, and the tab of the address. The
// header and the Overview are one read, `GET /investments/{accountId}` for the period; each other tab
// reads its own route. The period lives in the address; the tabs carry it from one to the next.
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { lazy, type ReactNode, Suspense } from "react";
import { Card } from "@ledgerly/ui/card";
import { Skeleton } from "@ledgerly/ui/skeleton";
import { investments } from "@ledgerly/api-contract/investments";
import { Badge } from "@ledgerly/ui/badge";
import { useApi, useLatest } from "@ledgerly/ui/data";
import { parseSectionQuery, SECTION_PRESETS, type SectionQuery } from "@ledgerly/ui/period";
import { PeriodBar } from "@ledgerly/ui/period-bar";
import { answeredPeriodText } from "@ledgerly/ui/period-text";
import { PortfolioDetail } from "@ledgerly/ui/portfolio-detail";
import { Page } from "@ledgerly/ui/shell/page";
import { TabLinks } from "@ledgerly/ui/tab-links";
import type { Params } from "@ledgerly/ui/url";
import { type Say, useSay } from "@/platform/say";
import { Ready } from "../ready";
import { ServiceSkeleton } from "../skeletons";
import { useServiceHeader } from "./service-header";
import { type ServiceTabKey, tabPath } from "./service-tabs";
import { servicePage, type ServicePage } from "./service-view";

// Each tab is loaded on its own: a tab's page carries the code of that tab only.
const OverviewTab = lazy(() =>
  import("../overview/overview-tab").then((tab) => ({ default: tab.OverviewTab })),
);
const PositionsTab = lazy(() =>
  import("../positions/positions-tab").then((tab) => ({ default: tab.PositionsTab })),
);
const PlansTab = lazy(() => import("../plans/plans-tab").then((tab) => ({ default: tab.PlansTab })));
const ActivityTab = lazy(() =>
  import("../activity/activity-tab").then((tab) => ({ default: tab.ActivityTab })),
);
const ConnectionTab = lazy(() =>
  import("../connection/connection-tab").then((tab) => ({ default: tab.ConnectionTab })),
);

/** The address's own parameters that belong to the period, and the page of a list. */
const PERIOD_KEYS = new Set(["preset", "from", "to", "off", "p"]);

interface Tab {
  key: ServiceTabKey;
  label: string;
  badge?: ReactNode;
}

function useTabs(page: ServicePage): Tab[] {
  const text = useTranslations("investments");
  const { service } = page.overview;
  const alerts = service.warnings.alerts;
  return [
    { key: "overview", label: text("tabs.overview") },
    // A service kept by value has no positions (PERS-335): no tab for them; a manual portfolio has (R5d).
    ...(service.origin === "synced" || page.context.portfolio
      ? [{ key: "positions" as const, label: text("tabs.positions") }]
      : []),
    // The purchase plans live in a manual portfolio only (§11.3.3).
    ...(page.context.portfolio ? [{ key: "plans" as const, label: text("tabs.plans") }] : []),
    { key: "activity", label: text("tabs.activity") },
    {
      key: "connection",
      // A manual account has nothing connected: its settings and corrections only (§1.1).
      label: service.sync ? text("tabs.connection") : text("tabs.settings"),
      badge:
        alerts > 0 ? (
          <Badge tone="warn">
            <span aria-hidden>{alerts}</span>
            <span className="sr-only">{text("tabs.alerts", { count: alerts })}</span>
          </Badge>
        ) : undefined,
    },
  ];
}

function ServiceNav({ page, tabs }: { page: ServicePage; tabs: readonly Tab[] }) {
  const text = useTranslations("investments");
  return (
    <TabLinks
      label={text("tabs.label")}
      tabs={tabs.map((tab) => ({
        href: page.href(tab.key),
        label: tab.badge ? (
          <span className="inline-flex items-center gap-1.5">
            {tab.label}
            {tab.badge}
          </span>
        ) : (
          tab.label
        ),
        active: tab.key === page.tab,
      }))}
    />
  );
}

/** The period, on every tab but Connection, which is always today (§2.3). */
function ServicePeriod({ page }: { page: ServicePage }) {
  if (page.tab === "connection") return null;
  const { period } = page.overview;
  // The tab's own parameters ride along but the page: a new period starts on the first page.
  const carry: Params = {};
  for (const [key, value] of page.search.entries()) if (!PERIOD_KEYS.has(key)) carry[key] = value;
  return (
    <PeriodBar
      period={page.section}
      path={tabPath(page.id, page.tab)}
      carry={carry}
      locale={page.say.locale}
      presets={SECTION_PRESETS}
      name={period.kind === "year" ? page.name : undefined}
      whole={{ range: period.span, text: page.name }}
    />
  );
}

function Tab({ page }: { page: ServicePage }) {
  if (page.tab === "positions") return <PositionsTab page={page} />;
  if (page.tab === "plans") return <PlansTab page={page} />;
  if (page.tab === "activity") return <ActivityTab page={page} />;
  if (page.tab === "connection") return <ConnectionTab page={page} />;
  return <OverviewTab page={page} />;
}

/** The tab of the address, with the shape of a card while its code is read. */
function TabBody({ page }: { page: ServicePage }) {
  return (
    <Suspense
      fallback={
        <Card>
          <Skeleton className="h-52 w-full" />
        </Card>
      }
    >
      <Tab page={page} />
    </Suspense>
  );
}

function ServiceView({ page }: { page: ServicePage }) {
  const text = useTranslations("investments");
  const tabs = useTabs(page);
  const header = useServiceHeader(page);
  const open = tabs.findIndex((tab) => tab.key === page.tab);
  const name = page.overview.service.name;
  return (
    <Page
      title={open <= 0 ? name : `${name} / ${tabs[open].label}`}
      parent={{ href: "/investments", label: text("title") }}
    >
      <PortfolioDetail
        header={header}
        tabs={<ServiceNav page={page} tabs={tabs} />}
        period={<ServicePeriod page={page} />}
      >
        <TabBody page={page} />
      </PortfolioDetail>
    </Page>
  );
}

function ServiceRead({
  id,
  tab,
  say,
  section,
}: {
  id: string;
  tab: ServiceTabKey;
  say: Say;
  section: SectionQuery;
}) {
  const words = useTranslations("common.period");
  const search = useSearchParams();
  const read = useLatest(
    useApi(investments.getInvestment, { params: { accountId: id }, query: section.api }),
  );
  return (
    <Ready state={read} skeleton={<ServiceSkeleton />}>
      {(overview) => (
        <ServiceView
          page={servicePage({
            id,
            tab,
            say,
            section,
            search: new URLSearchParams(search.toString()),
            overview,
            name: answeredPeriodText(overview.period, say.todayOn, say.locale, words),
          })}
        />
      )}
    </Ready>
  );
}

export function ServiceScreen({ id, tab }: { id: string; tab: ServiceTabKey }) {
  const search = useSearchParams();
  const say = useSay();
  return (
    <Ready state={say} skeleton={<ServiceSkeleton />}>
      {(person) => (
        <ServiceRead
          id={id}
          tab={tab}
          say={person}
          section={parseSectionQuery(Object.fromEntries(search.entries()), person.todayOn)}
        />
      )}
    </Ready>
  );
}
