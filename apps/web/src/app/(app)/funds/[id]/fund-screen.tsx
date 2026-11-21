"use client";

// A fund's page (docs/design/funds-ux.md §5.3, §6, F3; rewrite plan, ux/n6-pension-fund.md §5), read
// from `/api/v1` (rewrite plan R3): the header, the tabs, the period and the tab of the address, each
// tab one read of its own route. One page for every fund: a section appears when the fund's
// configuration calls for it, never by a kind of fund. The period is in the address and stays from the
// home to the fund and from a tab to the next.
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { funds as fundRoutes } from "@ledgerly/api-contract/funds";
import { parseCents } from "@ledgerly/format/cents";
import { formatDate, formatMoney } from "@ledgerly/format/format";
import { Badge } from "@ledgerly/ui/badge";
import { ButtonLink } from "@ledgerly/ui/button";
import { useApi, useLatest } from "@ledgerly/ui/data";
import { DetailHeader } from "@ledgerly/ui/detail-header";
import { Loaded } from "@ledgerly/ui/loaded";
import { parseSectionQuery, SECTION_PRESETS, type SectionQuery } from "@ledgerly/ui/period";
import { PeriodBar } from "@ledgerly/ui/period-bar";
import { type AnsweredPeriod, answeredPeriodText, answeredSpan } from "@ledgerly/ui/period-text";
import { Page } from "@ledgerly/ui/shell/page";
import { EmptyState } from "@ledgerly/ui/states";
import { TabLinks } from "@ledgerly/ui/tab-links";
import { type Params, withParams } from "@ledgerly/ui/url";
import {
  ContributionButton,
  contributionSetupOf,
  FundContributions,
  FundOverview,
  FundSettings,
  FundValuations,
  type Say,
  useMovements,
  usePeriodLabel,
  useSay,
  ValuationButton,
} from "@/modules/funds/client";
import { FundDetailSkeleton } from "./fund-skeleton";

const HOME = "/funds";
/** The tabs of a fund: the same four for every fund. */
const TABS = ["overview", "contributions", "valuations", "settings"] as const;
type Tab = (typeof TABS)[number];
const VIEWS = ["value", "return"] as const;

interface Place {
  id: string;
  tab: Tab;
  view: "gain" | "value" | "return";
  section: SectionQuery;
  base: string;
  say: Say;
}

export function FundScreen({ id }: { id: string }) {
  const query = useSearchParams();
  const say = useSay();
  if (say.data === undefined)
    return say.error ? <Loaded state={say}>{() => null}</Loaded> : <FundDetailSkeleton />;
  const raw = Object.fromEntries(query.entries());
  const place: Place = {
    id,
    tab: TABS.find((name) => name === raw.tab) ?? "overview",
    view: VIEWS.find((key) => key === raw.view) ?? "gain",
    section: parseSectionQuery(raw, say.data.todayOn),
    base: `${HOME}/${id}`,
    say: say.data,
  };
  return <FundFrame place={place} />;
}

/** The fund itself, the same on every tab: its settings answer its name and its sources. */
function FundFrame({ place }: { place: Place }) {
  const settings = useLatest(useApi(fundRoutes.getFundSettings, { params: { id: place.id } }));
  if (settings.data === undefined)
    return settings.error ? <Loaded state={settings}>{() => null}</Loaded> : <FundDetailSkeleton />;
  return <FundPage place={place} settings={settings.data} />;
}

type Settings = NonNullable<ReturnType<typeof useApi<typeof fundRoutes.getFundSettings>>["data"]>;

/** The route of a tab that follows the period; Settings does not. */
const routeOf = (tab: Tab) =>
  tab === "contributions"
    ? fundRoutes.getFundContributions
    : tab === "valuations"
      ? fundRoutes.getFundValuations
      : fundRoutes.getFund;

/** The period the tab of the address answered: the tab's own read, so the page reads it once. */
function useTabPeriod(place: Place): AnsweredPeriod | undefined {
  const read = useLatest(useApi(routeOf(place.tab), { params: { id: place.id }, query: place.section.api }));
  return place.tab === "settings" ? undefined : read.data?.period;
}

/** The year asked as the stepper asks it: the year running is the default, an earlier one steps back. */
function yearQuery(year: number, todayOn: string): Params {
  const back = Number(todayOn.slice(0, 4)) - year;
  return back > 0 ? { off: String(back) } : {};
}

/** The words of the period answered: "in 2025", "since…", "from… to…". */
function usePeriodWhen(period: AnsweredPeriod | undefined, say: Say) {
  const home = useTranslations("funds.home");
  if (!period) return "";
  if (period.kind === "year") return home("when.year", { year: period.year ?? 0 });
  if (period.kind === "all") return home("when.all");
  return home("when.custom", {
    from: formatDate(answeredSpan(period).from, "long", say.locale),
    to: formatDate(answeredSpan(period).to, "long", say.locale),
  });
}

/** The tab and the view the period's links carry. */
function keptOf({ tab, view }: Place): Params {
  return {
    tab: tab === "overview" ? undefined : tab,
    view: view === "gain" ? undefined : view,
  };
}

function FundPage({ place, settings }: { place: Place; settings: Settings }) {
  const fundsText = useTranslations("funds");
  const fundText = useTranslations("funds.fund");
  const periodText = useTranslations("common.period");
  const { fund, sources } = settings;
  const { say, base, section, tab } = place;
  const archived = fund.state === "archived";
  const byHand = sources.some((source) => source.kind === "manual");
  const accrual =
    sources.find((source) => source.id === settings.payrollSourceId)?.accrualPeriod ?? undefined;
  const label = usePeriodLabel(accrual, say);
  const period = useTabPeriod(place);
  const kept = keptOf(place);
  const tabHref = (name: string) =>
    withParams(base, section.params, { tab: name === "overview" ? undefined : name });
  const yearHref = (year: number) => withParams(base, kept, yearQuery(year, say.todayOn));
  const name = period ? answeredPeriodText(period, say.todayOn, say.locale, periodText) : "";
  const when = usePeriodWhen(period, say);
  const recordContribution = (variant: "primary" | "secondary", size: "sm" | "md" | "lg" = "sm") =>
    archived ? null : <RecordContribution place={place} variant={variant} size={size} label={label} />;
  const valuationButton = (text: string, where: "page" | "card") => (
    <UpdateValue place={place} fundName={fund.name} label={text} where={where} />
  );

  return (
    <Page
      title={fund.name}
      parent={{ href: withParams(HOME, {}, section.params), label: fundsText("title") }}
      actions={
        !archived && (
          <span className="flex gap-2">
            {byHand && <span className="max-md:hidden">{recordContribution("secondary")}</span>}
            {valuationButton(fundText("recordValue"), "page")}
          </span>
        )
      }
    >
      <FundHeader
        settings={settings}
        say={say}
        // On a phone the top bar has room for one command: the second sits beside the title (§11.1).
        aside={byHand && <span className="md:hidden">{recordContribution("secondary", "lg")}</span>}
      />
      <FundNav place={place} period={period} name={name} kept={kept} tabHref={tabHref} />
      {tab === "settings" ? (
        <FundSettings fundId={fund.id} />
      ) : (
        <TabBody
          place={place}
          archived={archived}
          name={name}
          when={when}
          label={label}
          tabHref={tabHref}
          yearHref={yearHref}
          recordContribution={(variant) => recordContribution(variant)}
          valuationButton={valuationButton}
        />
      )}
    </Page>
  );
}

/** The fund's name, its badge when archived, and its provider, compartment and start. */
function FundHeader({ settings, say, aside }: { settings: Settings; say: Say; aside: React.ReactNode }) {
  const fundsText = useTranslations("funds");
  const home = useTranslations("funds.home");
  const { fund } = settings;
  return (
    <DetailHeader
      metaTestId="fund-meta"
      meta={[
        fund.provider,
        fund.compartment,
        fundsText("detail.since", { date: formatDate(fund.startOn, "monthYear", say.locale) }),
      ]}
      title={
        <>
          {fund.name}
          {fund.state === "archived" && <Badge tone="neutral">{home("list.archived")}</Badge>}
        </>
      }
      titleAside={aside}
    />
  );
}

/** The tabs, and the period bar on every tab that follows the period. */
function FundNav({
  place,
  period,
  name,
  kept,
  tabHref,
}: {
  place: Place;
  period: AnsweredPeriod | undefined;
  name: string;
  kept: Params;
  tabHref: (tab: string) => string;
}) {
  const fundsText = useTranslations("funds");
  const fundText = useTranslations("funds.fund");
  const { say, base, section, tab } = place;
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <TabLinks
        label={fundsText("detail.tabs.label")}
        tabs={TABS.map((one) => ({
          href: tabHref(one),
          label: fundText(`tabs.${one}`),
          active: one === tab,
        }))}
      />
      {tab !== "settings" && period && (
        <PeriodBar
          period={section}
          path={base}
          carry={kept}
          locale={say.locale}
          presets={SECTION_PRESETS}
          name={period.kind === "year" ? name : undefined}
          whole={{ range: answeredSpan(period), text: name }}
        />
      )}
    </div>
  );
}

type FundRead = NonNullable<ReturnType<typeof useApi<typeof fundRoutes.getFund>>["data"]>;

/** A year before anything there is (§6): no number to show, a link to the first year. */
function BeforeFirst({
  overview,
  place,
  when,
  yearHref,
}: {
  overview: FundRead;
  place: Place;
  when: string;
  yearHref: (year: number) => string;
}) {
  const home = useTranslations("funds.home");
  const firstOn = overview.period.firstOn;
  const firstYear = firstOn === null ? Number(place.say.todayOn.slice(0, 4)) : Number(firstOn.slice(0, 4));
  return (
    <EmptyState
      title={home("noDataTitle", { when })}
      description={home("noDataNote", { date: formatDate(firstOn, "long", place.say.locale) })}
      actions={
        <ButtonLink href={yearHref(firstYear)} variant="primary">
          {home("noDataLink", { year: firstYear })}
        </ButtonLink>
      }
    />
  );
}

function TabBody(props: {
  place: Place;
  archived: boolean;
  name: string;
  when: string;
  label: (year: number, index: number) => string;
  tabHref: (tab: string) => string;
  yearHref: (year: number) => string;
  recordContribution: (variant: "primary" | "secondary") => React.ReactNode;
  valuationButton: (text: string, where: "page" | "card") => React.ReactNode;
}) {
  const { place, archived, when, tabHref } = props;
  const fundText = useTranslations("funds.fund");
  const input = { params: { id: place.id }, query: place.section.api };
  // `beforeFirst` is the Overview's: every tab that follows the period asks it (request on the issue).
  const overview = useLatest(useApi(fundRoutes.getFund, input));
  // A year before anything there is (§6): no number to show.
  if (overview.data?.beforeFirst)
    return <BeforeFirst overview={overview.data} place={place} when={when} yearHref={props.yearHref} />;
  if (place.tab === "contributions")
    return (
      <FundContributions
        fundId={place.id}
        period={place.section.api}
        when={when}
        settingsHref={tabHref("settings")}
      />
    );
  if (place.tab === "valuations")
    return (
      <FundValuations
        fundId={place.id}
        archived={archived}
        period={place.section.api}
        when={when}
        updateValue={archived ? null : props.valuationButton(fundText("recordValue"), "card")}
      />
    );
  return (
    <Loaded state={overview}>
      {(read) => (
        <FundOverview
          overview={read}
          say={place.say}
          name={props.name}
          when={when}
          view={place.view}
          base={place.base}
          params={{ ...place.section.params }}
          tabHref={tabHref}
          yearHref={props.yearHref}
          label={props.label}
          recordContribution={props.recordContribution}
          valuationButton={props.valuationButton}
        />
      )}
    </Loaded>
  );
}

/** "Record contribution": what the dialog opens with is the Contributions tab's own read. */
function RecordContribution({
  place,
  variant,
  size,
  label,
}: {
  place: Place;
  variant: "primary" | "secondary";
  size: "sm" | "md" | "lg";
  label: (year: number, index: number) => string;
}) {
  const fundsText = useTranslations("funds");
  const read = useApi(fundRoutes.getFundContributions, {
    params: { id: place.id },
    query: place.section.api,
  });
  const debit = read.data?.debits.find((one) => one.state === "active") ?? null;
  const movements = useMovements(place.id, debit?.accountId ?? null, place.say);
  const setup = read.data && contributionSetupOf(read.data, place.say, movements, label);
  if (!setup) return null;
  return (
    <ContributionButton
      setup={setup}
      label={fundsText("contribution.record")}
      variant={variant}
      size={size}
    />
  );
}

/** "Update value", with the last value recorded under its fields. */
function UpdateValue({
  place,
  fundName,
  label,
  where,
}: {
  place: Place;
  fundName: string;
  label: string;
  where: "page" | "card";
}) {
  const fundsText = useTranslations("funds");
  const read = useApi(fundRoutes.getFundValuations, { params: { id: place.id }, query: place.section.api });
  const last = read.data?.recorded[0];
  const lastLine = last
    ? fundsText("valuations.form.last", {
        value: formatMoney(parseCents(last.value), place.say.format),
        date: formatDate(last.on, "long", place.say.locale),
      })
    : null;
  return (
    <ValuationButton
      fundId={place.id}
      fundName={fundName}
      today={place.say.todayOn}
      lastLine={lastLine}
      label={label}
      place={where}
    />
  );
}
