"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { PALETTE } from "@ledgerly/design-tokens";
import { formatDate, formatDecimalText, formatMoney, formatPercent } from "@ledgerly/format/format";
import { ButtonLink } from "@ledgerly/ui/button";
import { Card } from "@ledgerly/ui/card";
import { cn } from "@ledgerly/ui/cn";
import { TONE_TEXT, toneOfSign } from "@ledgerly/ui/tone";
import type { Params } from "@ledgerly/ui/url";
import { FundChart } from "./fund-chart";
import {
  BridgeCard,
  MissingDebit,
  OnTheWay,
  type Overview,
  OverviewKpis,
  RecentCard,
} from "./overview-cards";
import { ClosedProjection, ShortProjection } from "./projection";
import type { Say } from "./say";
import { cents } from "./wire-forms";

interface OverviewProps {
  overview: Overview;
  say: Say;
  /** The period in words, and the same as "in 2025", "since…", "from… to…". */
  name: string;
  when: string;
  view: "gain" | "value" | "return";
  base: string;
  /** The period's parameters, without the chart's view. */
  params: Params;
  /** The address of a tab, and of a year, on this period. */
  tabHref: (tab: string) => string;
  yearHref: (year: number) => string;
  label: (year: number, index: number) => string;
  /** "Record contribution" in a variant, for a fund that takes payments by hand; null otherwise. */
  recordContribution: (variant: "primary" | "secondary") => ReactNode;
  /** "Update value" in its place. */
  valuationButton: (text: string, place: "page" | "card") => ReactNode;
}

/**
 * A fund's Overview (docs/design/funds-ux.md §5.3, §6, F3), read from `GET /funds/{id}` (rewrite
 * plan R3): the gain of the period and what explains it, the chart, the money of the period and the
 * projection. "On the way", the recurring debit and the projection stay as of today.
 */
export function FundOverview(props: OverviewProps) {
  const { overview, say, tabHref, label } = props;
  const { fund, debit } = overview;
  const archived = fund.state === "archived";
  const paidLabel = usePaidLabel(overview, say);
  const firstStep = !archived && overview.operationsEver === 0 && overview.competencesEver === 0;
  // A fund with nothing in it yet: the two things to do first, in one card (§10.5).
  const firstSteps = firstStep && overview.valuesEver === 0;
  return (
    <>
      <Hero {...props} firstSteps={firstSteps} />
      {firstSteps && <FirstStepsCard {...props} />}
      {debit !== null && debit.state === "active" && debit.status === "missing" && (
        <MissingDebit debit={debit} say={say} />
      )}
      <OnTheWay overview={overview} say={say} href={tabHref("contributions")} label={label} />
      <OverviewKpis overview={overview} say={say} paidLabel={paidLabel} />
      <Performance {...props} />
      <RecentAndProjection {...props} firstStep={firstStep} />
    </>
  );
}

/** The money of the period, the bridge and the projection, side by side when they fit. */
function RecentAndProjection(props: OverviewProps & { firstStep: boolean }) {
  const { overview, say, tabHref, label, firstStep } = props;
  const shortProjection = overview.forecast.layout === "short";

  const recentCard = (
    <RecentCard
      overview={overview}
      say={say}
      href={tabHref("contributions")}
      firstStep={firstStep && props.recordContribution("secondary")}
      label={label}
    />
  );

  return (
    <>
      {shortProjection || overview.bridge !== null ? (
        <div className="grid min-w-0 items-start gap-4 @4xl:grid-cols-2">
          {recentCard}
          <BridgeCard overview={overview} say={say} />
          {shortProjection && <ShortProjection format={say.format} forecast={overview.forecast} />}
        </div>
      ) : (
        recentCard
      )}
      {!shortProjection && <ClosedProjection format={say.format} forecast={overview.forecast} />}
    </>
  );
}

/** The KPI label of the money paid in the period. */
function usePaidLabel(overview: Overview, say: Say) {
  const home = useTranslations("funds.home");
  const { period } = overview;
  const thisYear = Number(say.todayOn.slice(0, 4));
  return period.kind === "year"
    ? home("kpis.paidInYear", { year: period.year ?? thisYear })
    : period.kind === "all"
      ? home("kpis.paidIn")
      : home("kpis.paidInPeriod");
}

/** The first-steps card: record a contribution and a first value. */
function FirstStepsCard(props: OverviewProps) {
  const fundText = useTranslations("funds.fund");
  return (
    <Card data-testid="fund-first-steps" className="flex min-w-0 flex-col items-start gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{fundText("firstSteps.title")}</h2>
        <p className="text-sm text-muted">{fundText("firstSteps.text")}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {props.recordContribution("primary")}
        {props.valuationButton(fundText("recordValue"), "card")}
      </div>
    </Card>
  );
}

/** The chart of the period, or the card of a period with payslips only. */
function Performance(props: OverviewProps) {
  const { overview, say, when, view, base, params } = props;
  const fundText = useTranslations("funds.fund");
  const { fund, summary, line } = overview;
  const color = fund.color ?? PALETTE[0];
  if (summary.state === "payslips_only") return <PayslipsOnly {...props} />;
  return (
    <FundChart
      say={say}
      lines={[{ id: fund.id, name: fund.name, color, gain: line.status === "measured" ? line.gain : null }]}
      gain={overview.gain}
      values={overview.values}
      bySign
      when={when}
      total={line.gain}
      rate={line.rate}
      view={view}
      path={base}
      params={params}
      gainNote={(grain) => fundText(`chartNote.${grain}`, { when })}
    />
  );
}

/** A period with payslips only: no chart, the ways to the next year and to the contributions. */
function PayslipsOnly({ overview, say, when, tabHref, yearHref }: OverviewProps) {
  const home = useTranslations("funds.home");
  const { period } = overview;
  const thisYear = Number(say.todayOn.slice(0, 4));
  return (
    <Card data-testid="payslips-only" className="flex flex-col items-start gap-3">
      <h2 className="text-lg font-semibold">{home("chart.empty", { when })}</h2>
      <div className="flex flex-wrap gap-2">
        {period.kind === "year" && overview.firstPaidOn !== null && (
          <ButtonLink
            href={yearHref(Math.min((period.year ?? thisYear) + 1, thisYear))}
            variant="primary"
            size="sm"
          >
            {home("goToYear", { year: Math.min((period.year ?? thisYear) + 1, thisYear) })}
          </ButtonLink>
        )}
        <ButtonLink href={tabHref("contributions")} variant="ghost" size="sm">
          {period.kind === "year"
            ? home("openContributions", { year: period.year ?? thisYear })
            : home("chart.data")}
        </ButtonLink>
      </div>
    </Card>
  );
}

const strong = (chunks: ReactNode) => (
  <strong className="font-semibold text-fg tabular-nums">{chunks}</strong>
);

/** The value line under the gain: the value at the end of the period, its units, and today's value. */
function useValueLine({ overview, say }: OverviewProps): ReactNode {
  const fundText = useTranslations("funds.fund");
  const money = (amount: string | null) => formatMoney(cents(amount), say.format);
  const day = (date: string | null) => formatDate(date, "dayMonth", say.locale);
  // The server caps a period at today: it reaches today or it ended before.
  const past = overview.period.to < say.todayOn;
  const valuePart = useValuePart(overview, say, past);
  const todayPart =
    past && overview.valueToday !== null && overview.valueTodayOn !== null ? (
      <span data-testid="fund-value-today">
        {fundText("hero.today", { value: money(overview.valueToday), date: day(overview.valueTodayOn) })}
      </span>
    ) : null;
  if (valuePart === null && todayPart === null) return null;
  return (
    <>
      {valuePart}
      {valuePart !== null && todayPart !== null && " · "}
      {todayPart}
    </>
  );
}

/** The value at the end of the period, with its units and unit price when the period reaches today. */
function useValuePart(overview: Overview, say: Say, past: boolean): ReactNode {
  const home = useTranslations("funds.home");
  const fundText = useTranslations("funds.fund");
  const { fund, period, line } = overview;
  const money = (amount: string | null) => formatMoney(cents(amount), say.format);
  const long = (date: string | null) => formatDate(date, "long", say.locale);
  const day = (date: string | null) => formatDate(date, "dayMonth", say.locale);
  const { end } = line;
  const measured = line.status === "measured";
  const archived = fund.state === "archived";
  if (end === null) return null;
  if (!measured || (archived && !past)) {
    // An archived fund's old value stays in its gain, but it is not money held today, as in the home.
    return home.rich("lastValue", {
      value: money(end.value),
      dates: home("valuesOn", { date: long(end.on) }),
      strong,
    });
  }
  if (past) {
    return period.kind === "year"
      ? fundText.rich("hero.valueAtYearEnd", { value: money(end.value), date: long(end.on), strong })
      : fundText.rich("hero.valueAtEnd", {
          end: long(period.to),
          value: money(end.value),
          date: long(end.on),
          strong,
        });
  }
  return (
    <>
      {fundText.rich("hero.value", { value: money(end.value), date: long(end.on), strong })}
      {overview.units !== null &&
        ` · ${fundText("hero.units", { units: formatDecimalText(overview.units, say.format, { max: 3 }) })}`}
      {overview.lastPrice &&
        ` · ${fundText("hero.unitPrice", {
          price: formatDecimalText(overview.lastPrice.price, say.format, {
            min: 2,
            max: 4,
            currency: "EUR",
          }),
          date: day(overview.lastPrice.on),
        })}`}
    </>
  );
}

/** The notes of the period's state, in their order (§6). */
function useStateNotes(overview: Overview, say: Say, when: string) {
  const home = useTranslations("funds.home");
  const long = (date: string | null) => formatDate(date, "long", say.locale);
  const { state } = overview.summary;
  const archived = overview.fund.state === "archived";
  const measured = overview.line.status === "measured";
  return [
    state === "payslips_only"
      ? overview.firstValueOn
        ? home("payslipsNote", { when, date: long(overview.firstValueOn) })
        : home("payslipsNoValue", { when })
      : null,
    state === "paid_no_value" ? home("paidNote", { when }) : null,
    state === "quiet" ? home("quietNote", { when }) : null,
    !archived && !measured && (state === "paid_no_value" || state === "running_no_value")
      ? home("recordToMeasure", { when })
      : null,
  ];
}

/** The notes of the amounts: what payslips accrued with no value yet, and what the value does not hold. */
function useAmountNotes(overview: Overview, say: Say, noValueYet: boolean) {
  const home = useTranslations("funds.home");
  const fundText = useTranslations("funds.fund");
  const money = (amount: string | null) => formatMoney(cents(amount), say.format);
  const { line } = overview;
  return [
    noValueYet &&
    line.status === "never_valued" &&
    overview.payslipsAccrued !== null &&
    cents(overview.payslipsAccrued) !== 0n
      ? fundText("hero.accrued", { amount: money(overview.payslipsAccrued) })
      : null,
    line.end !== null && (cents(line.notInValue) ?? 0n) > 0n
      ? home("notInValue", { amount: money(line.notInValue) })
      : null,
  ];
}

/** The big figure of the period: the gain or why there is none, and the return. */
function HeroFigure({ overview, say, when }: { overview: Overview; say: Say; when: string }) {
  const home = useTranslations("funds.home");
  const { line } = overview;
  const gain = cents(line.gain);
  const percent = (value: number | null) => formatPercent(value, say.format, { signed: true });
  const heroText = useHeroText(overview, say, when);
  return (
    <p
      data-testid="funds-hero"
      data-state={overview.summary.state}
      data-cents={gain === null ? "" : String(gain)}
      className="flex flex-wrap items-baseline gap-x-3"
    >
      <span
        className={cn(
          "text-hero leading-tight font-semibold tracking-title tabular-nums",
          TONE_TEXT[toneOfSign(gain)],
        )}
      >
        {heroText}
      </span>
      {line.rate !== null && (
        <span
          data-testid="funds-rate"
          title={
            line.xirr?.status === "ok" ? home("list.xirr", { rate: percent(line.xirr.rate) }) : undefined
          }
          className={cn("text-lg font-semibold tabular-nums", TONE_TEXT[toneOfSign(line.rate)])}
        >
          {percent(line.rate)}
        </span>
      )}
    </p>
  );
}

/** The gain in money, or why the period has none. */
function useHeroText(overview: Overview, say: Say, when: string) {
  const home = useTranslations("funds.home");
  const { line, period, summary } = overview;
  if (line.status === "measured") return formatMoney(cents(line.gain), say.format, { signed: true });
  if (period.to >= say.todayOn) return home("noValueYet", { when });
  return summary.state === "quiet" ? home("noValueIn", { when }) : home("gainUndetermined");
}

/** The gain of the period, its return, the value line and the notes (§6). */
function Hero(props: OverviewProps & { firstSteps: boolean }) {
  const { overview, say, name, when, firstSteps } = props;
  const home = useTranslations("funds.home");
  const fundText = useTranslations("funds.fund");
  const { fund, period, summary, line } = overview;
  const archived = fund.state === "archived";
  const measured = line.status === "measured";
  const noValueYet = !measured && period.to >= say.todayOn;
  const valueLine = useValueLine(props);
  const notes = [...useStateNotes(overview, say, when), ...useAmountNotes(overview, say, noValueYet)].filter(
    (note) => note !== null,
  );
  return (
    <section aria-labelledby="fund-gain" className="flex min-w-0 flex-col gap-1">
      <h2 id="fund-gain" className="text-sm font-medium text-muted">
        {home("gainTitle", { period: name })}
      </h2>
      <HeroFigure overview={overview} say={say} when={when} />
      {valueLine && (
        <p data-testid="fund-value" className="text-sm text-muted">
          {valueLine}
        </p>
      )}
      {notes.map((note) => (
        <p key={note} className="text-sm text-muted">
          {note}
        </p>
      ))}
      {(noValueYet || (!measured && summary.state === "paid_no_value")) && !archived && !firstSteps && (
        <div className="pt-1">
          {props.valuationButton(
            line.status === "never_valued" ? home("list.first") : fundText("recordValue"),
            "card",
          )}
        </div>
      )}
    </section>
  );
}
