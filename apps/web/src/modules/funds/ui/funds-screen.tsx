"use client";

// Funds · the home (docs/design/funds-ux.md §5.3, §6, F2, mockups a-01 to a-04), read from `GET /funds`
// (rewrite plan R3): the gain of the period first, then what explains it, the chart, the funds, and who
// paid in. The period is in the address and drives every number here but "On the way" and the
// recurring debits, which stay as of today. Every figure is the server's.
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { funds as fundRoutes } from "@ledgerly/api-contract/funds";
import { PALETTE } from "@ledgerly/design-tokens";
import { formatDate, formatMoney } from "@ledgerly/format/format";
import { ButtonLink } from "@ledgerly/ui/button";
import { Card } from "@ledgerly/ui/card";
import { useApi, useLatest } from "@ledgerly/ui/data";
import { HighlightScope } from "@ledgerly/ui/highlight";
import { Loaded } from "@ledgerly/ui/loaded";
import { parseSectionQuery, SECTION_PRESETS, type SectionQuery } from "@ledgerly/ui/period";
import { PeriodBar } from "@ledgerly/ui/period-bar";
import { answeredPeriodText } from "@ledgerly/ui/period-text";
import { Link } from "@ledgerly/ui/router";
import { Page } from "@ledgerly/ui/shell/page";
import { EmptyState } from "@ledgerly/ui/states";
import { type Params, withParams } from "@ledgerly/ui/url";
import { FundChart } from "./fund-chart";
import { FundStateButton } from "./fund-forms";
import {
  FundsCard,
  type Home,
  type HomeFund,
  HomeKpis,
  type HomeWords,
  WhoPaidCard,
  YearsCard,
} from "./home-cards";
import { type Say, useSay } from "@/platform/say";
import { Hero, toCents } from "./home-hero";
import { FundsHomeSkeleton } from "./home-skeleton";

const PATH = "/funds";
const VIEWS = ["value", "return"] as const;

interface Place {
  view: "gain" | "value" | "return";
  kept: Params;
  section: SectionQuery;
  say: Say;
}

export function FundsScreen() {
  const query = useSearchParams();
  const say = useSay();
  if (say.data === undefined)
    return say.error ? <Loaded state={say}>{() => null}</Loaded> : <FundsHomeSkeleton />;
  const raw = Object.fromEntries(query.entries());
  const view = VIEWS.find((key) => key === raw.view) ?? "gain";
  const place: Place = {
    view,
    kept: { view: view === "gain" ? undefined : view },
    section: parseSectionQuery(raw, say.data.todayOn),
    say: say.data,
  };
  return <FundsHome place={place} />;
}

function FundsHome({ place }: { place: Place }) {
  const read = useLatest(useApi(fundRoutes.getFunds, { query: place.section.api }));
  if (read.data === undefined)
    return read.error ? <Loaded state={read}>{() => null}</Loaded> : <FundsHomeSkeleton />;
  return <HomeBody place={place} home={read.data} />;
}

/** "Add fund": the form that creates a fund is a page of its own. */
function AddFund({ label, size = "sm" }: { label: string; size?: "sm" | "md" }) {
  return (
    <ButtonLink href="/funds/new" variant="primary" size={size}>
      <Plus aria-hidden className="size-4" />
      {label}
    </ButtonLink>
  );
}

/** Most gain first, the funds with none after them: the order of the chart's stack, reversed. */
function byGain(left: HomeFund, right: HomeFund): number {
  const one = left.line?.gain ?? null;
  const other = right.line?.gain ?? null;
  const mine = one === null ? null : Number(one);
  const theirs = other === null ? null : Number(other);
  if (mine === theirs) return left.name < right.name ? -1 : 1;
  if (mine === null) return 1;
  if (theirs === null) return -1;
  return mine > theirs ? -1 : 1;
}

/** The period in words, the links and the colors the cards of the home share. */
function useHomeView(place: Place, home: Home) {
  const homeText = useTranslations("funds.home");
  const periodText = useTranslations("common.period");
  const { say, section, kept } = place;
  const { period } = home;
  const name = answeredPeriodText(period, say.todayOn, say.locale, periodText);
  const span = period.span;
  const when =
    period.kind === "year"
      ? homeText("when.year", { year: period.year ?? 0 })
      : period.kind === "all"
        ? homeText("when.all")
        : homeText("when.custom", {
            from: formatDate(span.from, "long", say.locale),
            to: formatDate(span.to, "long", say.locale),
          });
  const thisYear = Number(say.todayOn.slice(0, 4));
  const yearHref = (year: number) => {
    const back = thisYear - year;
    return withParams(PATH, kept, back > 0 ? { off: String(back) } : {});
  };
  const fundHref = (id: string, tab?: string) => withParams(`${PATH}/${id}`, section.params, { tab });
  const colorOf = (id: string) => {
    const index = home.funds.findIndex((one) => one.id === id);
    return home.funds[index]?.color ?? PALETTE[index % PALETTE.length];
  };
  const words: HomeWords = { say, when, fundHref, yearHref, colorOf };
  return { words, name, span };
}

function HomeBody({ place, home }: { place: Place; home: Home }) {
  const fundsText = useTranslations("funds");
  const { words, name, span } = useHomeView(place, home);
  const { say, section, kept } = place;
  const { period, summary } = home;
  const archived = home.funds.filter((one) => one.state === "archived");
  const open = home.funds.filter((one) => one.state !== "archived");
  const archivedList = <ArchivedList archived={archived} section={section} />;

  if (home.funds.length === 0) return <EmptyHome />;

  const pageHeader = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-title font-semibold tracking-title max-md:sr-only">{fundsText("title")}</h1>
      <PeriodBar
        period={section}
        path={PATH}
        carry={kept}
        locale={say.locale}
        presets={SECTION_PRESETS}
        name={period.kind === "year" ? name : undefined}
        whole={{ range: span, text: name }}
      />
    </div>
  );
  const alerts = <MissingDebits open={open} say={say} />;

  // ——— A year before anything there is: no number to show (§6) ———————————————————————————————
  if (summary.state === "before_first") {
    return (
      <Page title={fundsText("title")} actions={<AddFund label={fundsText("add")} />}>
        {alerts}
        {pageHeader}
        <BeforeFirst home={home} words={words} />
        {archivedList}
      </Page>
    );
  }

  const lines = home.funds.filter((one) => one.line !== null).sort(byGain);
  return (
    <Page title={fundsText("title")} actions={<AddFund label={fundsText("add")} />}>
      {alerts}
      {pageHeader}
      <Hero home={home} words={words} name={name} open={open} />
      <HomeKpis home={home} words={words} />
      <HighlightScope className="flex flex-col gap-4">
        <HomeChart place={place} home={home} lines={lines} words={words} />
        <YearsCard home={home} words={words} />
        {summary.state !== "payslips_only" && (
          <div className="grid items-start gap-4 @6xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <FundsCard home={home} lines={lines} words={words} />
            <WhoPaidCard home={home} words={words} />
          </div>
        )}
      </HighlightScope>
      {archivedList}
    </Page>
  );
}

/** No fund yet: the way to the first one. */
function EmptyHome() {
  const fundsText = useTranslations("funds");
  return (
    <Page title={fundsText("title")} actions={<AddFund label={fundsText("add")} />}>
      <h1 className="text-title font-semibold tracking-title max-md:sr-only">{fundsText("title")}</h1>
      <EmptyState
        title={fundsText("empty.title")}
        description={fundsText("empty.description")}
        actions={<AddFund label={fundsText("empty.cta")} size="md" />}
      />
    </Page>
  );
}

/** A period before the first operation: the way to the first year with data. */
function BeforeFirst({ home, words }: { home: Home; words: HomeWords }) {
  const homeText = useTranslations("funds.home");
  const { period } = home;
  const { say, when } = words;
  const thisYear = Number(say.todayOn.slice(0, 4));
  const firstYear = period.firstOn === null ? thisYear : Number(period.firstOn.slice(0, 4));
  return (
    <EmptyState
      title={homeText("noDataTitle", { when })}
      description={homeText("noDataNote", { date: formatDate(period.firstOn, "long", say.locale) })}
      actions={
        <ButtonLink href={words.yearHref(firstYear)} variant="primary">
          {homeText("noDataLink", { year: firstYear })}
        </ButtonLink>
      }
    />
  );
}

/** The chart of the period, or, with payslips only, the ways to a period that has values. */
function HomeChart({
  place,
  home,
  lines,
  words,
}: {
  place: Place;
  home: Home;
  lines: readonly HomeFund[];
  words: HomeWords;
}) {
  const homeText = useTranslations("funds.home");
  const { say, when, colorOf } = words;
  const { summary } = home;
  if (summary.state === "payslips_only") return <PayslipsOnlyCard home={home} words={words} />;
  return (
    <FundChart
      say={say}
      lines={lines.map((one) => ({
        id: one.id,
        name: one.name,
        color: colorOf(one.id),
        gain: one.line?.status === "measured" ? one.line.gain : null,
      }))}
      gain={home.gain}
      values={home.values}
      when={when}
      total={summary.gain}
      rate={summary.rate}
      view={place.view}
      path={PATH}
      params={place.section.params}
      gainNote={(grain) => homeText(`chart.gainNote.${grain}`, { when })}
    />
  );
}

function PayslipsOnlyCard({ home, words }: { home: Home; words: HomeWords }) {
  const homeText = useTranslations("funds.home");
  const { period } = home;
  const { when } = words;
  const thisYear = Number(words.say.todayOn.slice(0, 4));
  const accruedFund = home.accrued && home.funds.find((one) => one.id === home.accrued?.fundId);
  return (
    <Card data-testid="payslips-only" className="flex flex-col items-start gap-3">
      <h2 className="text-lg font-semibold">{homeText("chart.empty", { when })}</h2>
      <div className="flex flex-wrap gap-2">
        {period.kind === "year" && home.firstPaidOn !== null && (
          <ButtonLink
            href={words.yearHref(Math.min((period.year ?? thisYear) + 1, thisYear))}
            variant="primary"
            size="sm"
          >
            {homeText("goToYear", { year: Math.min((period.year ?? thisYear) + 1, thisYear) })}
          </ButtonLink>
        )}
        {accruedFund && (
          <ButtonLink href={words.fundHref(accruedFund.id, "contributions")} variant="ghost" size="sm">
            {period.kind === "year"
              ? homeText("openContributions", { year: period.year ?? thisYear })
              : homeText("chart.data")}
          </ButtonLink>
        )}
      </div>
    </Card>
  );
}

/** Every recurring debit of an open fund that was not found by its day: always as of today. */
function MissingDebits({ open, say }: { open: readonly HomeFund[]; say: Say }) {
  const fundsText = useTranslations("funds");
  const missing = open.filter((one) => one.debit?.state === "active" && one.debit.status === "missing");
  if (missing.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      {missing.map((one) => (
        <div
          key={one.debit?.sourceId}
          data-testid="fund-alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-neg/30 bg-neg-bg px-3 py-2 text-sm"
        >
          <p>
            <strong className="font-semibold">{one.name}</strong> —{" "}
            {fundsText("alert.missing", {
              date: formatDate(one.debit?.by ?? null, "long", say.locale),
              amount: formatMoney(toCents(one.debit?.amount ?? null), say.format),
            })}
          </p>
          <Link
            href="/expenses"
            className="focus-ring inline-flex min-h-6 shrink-0 items-center rounded-xs font-medium text-accent hover:underline"
          >
            {fundsText("alert.cta")}
          </Link>
        </div>
      ))}
    </section>
  );
}

/** The archived funds under the page, each with "Restore". */
function ArchivedList({ archived, section }: { archived: readonly HomeFund[]; section: SectionQuery }) {
  const fundsText = useTranslations("funds");
  if (archived.length === 0) return null;
  return (
    <details className="text-sm">
      <summary className="focus-ring inline-flex min-h-6 cursor-pointer items-center rounded-sm text-muted">
        {fundsText("archived.count", { count: archived.length })}
      </summary>
      <ul className="mt-2 flex flex-col gap-1">
        {archived.map((fund) => (
          <li key={fund.id} className="flex items-center justify-between gap-2">
            <Link
              href={withParams(`${PATH}/${fund.id}`, {}, section.params)}
              className="focus-ring inline-flex min-h-6 items-center rounded-sm hover:underline"
            >
              {fund.name}
            </Link>
            <FundStateButton
              fundId={fund.id}
              state="active"
              label={fundsText("archived.restore")}
              toast={fundsText("toasts.restored")}
            />
          </li>
        ))}
      </ul>
    </details>
  );
}
