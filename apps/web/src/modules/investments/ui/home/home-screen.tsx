"use client";

// Investments · Profit & loss (docs/design/investments-ux.md §3.1, U2), read from `/api/v1` (rewrite plan
// R3): the P&L of the period first — with how far it can be trusted — then the value of today; its
// parts; the chart of the period by service; the services ordered by what they added; and what the
// portfolio holds today. The period is in the address (§1.2): the server measures it.
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { investments } from "@ledgerly/api-contract/investments";
import { useApi, useLatest } from "@ledgerly/ui/data";
import { HighlightScope } from "@ledgerly/ui/highlight";
import { parseSectionQuery, SECTION_PRESETS, type SectionQuery } from "@ledgerly/ui/period";
import { PeriodBar } from "@ledgerly/ui/period-bar";
import { answeredPeriodText } from "@ledgerly/ui/period-text";
import { Page } from "@ledgerly/ui/shell/page";
import { EmptyState } from "@ledgerly/ui/states";
import { type Say, useSay } from "@/platform/say";
import { AddInvestmentButton } from "../add-investment";
import { PartsKpis } from "../parts-kpis";
import { Ready } from "../ready";
import { HomeSkeleton } from "../skeletons";
import { HomeChart } from "./home-chart";
import { HomeComposition } from "./home-composition";
import { FundsLine, HomeHero } from "./home-hero";
import { HomeServices } from "./home-services";
import { type ChartView, type GroupBy, type Home, homeContext, type HomeContext } from "./home-view";

const VIEWS = ["return", "value"] as const;
const GROUPS = ["class", "ccy"] as const;

function Empty({ home, say }: { home: Home; say: Say }) {
  const text = useTranslations("investments");
  const context = homeContext(home, say, parseSectionQuery({}, say.todayOn), {
    view: "pnl",
    by: "service",
    name: "",
  });
  return (
    <>
      <h1 className="text-title font-semibold tracking-title max-md:sr-only">{text("title")}</h1>
      <EmptyState
        title={text("empty.title")}
        description={text("home.empty")}
        actions={<AddInvestmentButton />}
      />
      {home.funds.total !== null && home.funds.rows.length > 0 && (
        <p className="text-sm text-muted">
          <FundsLine amount={context.money(home.funds.total)} />
        </p>
      )}
    </>
  );
}

function HomeView({ context }: { context: HomeContext }) {
  const text = useTranslations("investments");
  const { home, section, say, name, kept } = context;
  const parts = home.pnl.parts;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-title font-semibold tracking-title max-md:sr-only">{text("title")}</h1>
        <PeriodBar
          period={section}
          path="/investments"
          carry={kept}
          locale={say.locale}
          presets={SECTION_PRESETS}
          name={home.period.kind === "year" ? name : undefined}
          whole={{ range: home.period.span, text: name }}
        />
      </div>
      <HomeHero context={context} />
      {parts && (
        <PartsKpis
          parts={parts}
          transfers={home.pnl.transfers}
          openPositions={home.pnl.openPositions}
          money={context.money}
        />
      )}
      <HighlightScope className="flex flex-col gap-4">
        <HomeChart context={context} />
        <div className="grid items-start gap-4 @4xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <HomeServices context={context} />
          <HomeComposition context={context} />
        </div>
      </HighlightScope>
    </>
  );
}

function HomeRead({ say, section }: { say: Say; section: SectionQuery }) {
  const text = useTranslations("investments");
  const words = useTranslations("common.period");
  const query = useSearchParams();
  const read = useLatest(useApi(investments.getInvestmentsHome, { query: section.api }));
  const view: ChartView = VIEWS.find((key) => key === query.get("view")) ?? "pnl";
  const grouping: GroupBy = GROUPS.find((key) => key === query.get("by")) ?? "service";
  return (
    <Ready state={read} skeleton={<HomeSkeleton />}>
      {(home) => (
        <Page title={text("title")} actions={<AddInvestmentButton size="sm" />}>
          {home.services.length === 0 ? (
            <Empty home={home} say={say} />
          ) : (
            <HomeView
              context={homeContext(home, say, section, {
                view,
                by: grouping,
                name: answeredPeriodText(home.period, say.todayOn, say.locale, words),
              })}
            />
          )}
        </Page>
      )}
    </Ready>
  );
}

export function InvestmentsHomeScreen() {
  const query = useSearchParams();
  const say = useSay();
  return (
    <Ready state={say} skeleton={<HomeSkeleton />}>
      {(person) => (
        <HomeRead
          say={person}
          section={parseSectionQuery(Object.fromEntries(query.entries()), person.todayOn)}
        />
      )}
    </Ready>
  );
}
