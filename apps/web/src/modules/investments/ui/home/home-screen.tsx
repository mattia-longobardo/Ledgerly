"use client";

// Investments (docs/design/investments-ux.md §3.1, U2; rewrite plan R5b), read from `/api/v1`: the one
// list first — the chips, the four KPIs and the groups with their rows, the pension funds among them —
// then, beside «Stocks and crypto», the P&L of the services with how far it can be trusted, its parts,
// the chart of the period by service, the services ordered by what they added, and what the portfolio
// holds today. The period and the chip are in the address (§1.2): the server measures the period.
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
import { HomeHero } from "./home-hero";
import { HomePortfolio } from "./home-portfolio";
import { HomeServices } from "./home-services";
import { type ChartView, CHIPS, type GroupBy, homeContext, type HomeContext } from "./home-view";

const VIEWS = ["return", "value"] as const;
const GROUPS = ["class", "ccy"] as const;

function Empty() {
  const text = useTranslations("investments");
  return (
    <>
      <h1 className="text-title font-semibold tracking-title max-md:sr-only">{text("title")}</h1>
      <EmptyState
        title={text("empty.title")}
        description={text("home.empty")}
        actions={<AddInvestmentButton />}
      />
    </>
  );
}

/** The P&L of the services, which belong to «Stocks and crypto»: their hero, parts, chart and list. */
function ServicesView({ context }: { context: HomeContext }) {
  const { home } = context;
  const parts = home.pnl.parts;
  return (
    <>
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

function HomeView({ context }: { context: HomeContext }) {
  const text = useTranslations("investments");
  const { home, section, say, name, kept, chip } = context;
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
      <HomePortfolio context={context} />
      {chip !== "pension_funds" && home.services.length > 0 && <ServicesView context={context} />}
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
  const chip = CHIPS.find((key) => key === query.get("group")) ?? "all";
  return (
    <Ready state={read} skeleton={<HomeSkeleton />}>
      {(home) => (
        <Page title={text("title")} actions={<AddInvestmentButton size="sm" />}>
          {home.groups.length === 0 ? (
            <Empty />
          ) : (
            <HomeView
              context={homeContext(home, say, section, {
                view,
                by: grouping,
                chip,
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
