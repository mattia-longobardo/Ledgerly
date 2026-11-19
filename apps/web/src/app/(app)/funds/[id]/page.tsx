import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { listAccounts } from "@ledgerly/domain/accounts";
import { colorFor } from "@/modules/accounts/ui/display";
import { fundSummary, hypothesesOnly, isFundId } from "@ledgerly/domain/funds";
import { isFutureYear, valueToday } from "@ledgerly/domain/funds";
import { fundHomeRow } from "@ledgerly/domain/funds";
import { hasPayrollCalendar } from "@ledgerly/domain/funds";
import { FundError, requireFund, takenComponents } from "@ledgerly/domain/funds";
import { closesPeriodBefore, inPeriod, legacyFundQuery, valuationLines } from "@ledgerly/domain/funds";
import { ContributionButton } from "@/modules/funds/ui/contribution-dialog";
import { FundChart } from "@/modules/funds/ui/fund-chart";
import { contributionSetup, FundContributions } from "@/modules/funds/ui/fund-contributions";
import { ValuationButton } from "@/modules/funds/ui/fund-forms";
import { Kpi } from "@/modules/funds/ui/fund-kpi";
import { FundSettings } from "@/modules/funds/ui/fund-settings";
import { FundValuations } from "@/modules/funds/ui/fund-valuations";
import { periodLabel } from "@/modules/funds/ui/pension-present";
import {
  monthPill,
  operationGross,
  operationOrigin,
  originParts,
  voluntaryCents,
} from "@/modules/funds/ui/present";
import { ClosedProjection, ShortProjection } from "@/modules/funds/ui/projection";
import { frequencyText } from "@/modules/funds/ui/source-text";
import {
  periodSpan,
  SECTION_PRESETS,
  sectionPeriod,
  type Query,
  yearQuery,
} from "@ledgerly/domain/investments";
import { PeriodBar } from "@/modules/accounts/ui/period-bar";
import { periodText } from "@/modules/investments/ui/period-control";
import { chargeCandidates } from "@ledgerly/domain/transactions";
import { requireSession } from "@/platform/auth/session";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { type CivilDate, today } from "@ledgerly/domain/shared/dates";
import {
  formatDate,
  formatDecimalText,
  formatMoney,
  formatPercent,
  NULL_DISPLAY,
} from "@ledgerly/domain/platform/format";
import type { Cents } from "@ledgerly/domain/shared/money";
import { Badge } from "@/ui/badge";
import { ButtonLink } from "@/ui/button";
import { Card, CardHeader } from "@/ui/card";
import { cn } from "@/ui/cn";
import { Page } from "@/ui/shell/page";
import { EmptyState } from "@/ui/states";
import { TabLinks } from "@/ui/tab-links";
import { TONE_TEXT, toneOfSign } from "@/ui/tone";
import { type Params, withParams } from "@/ui/url";
import { RebuildCompetencesButton } from "../fund-buttons";
import { FundDetailSkeleton } from "./fund-skeleton";

const HOME = "/funds";
/** The tabs of a fund: the same four for every fund. */
const TABS = ["overview", "contributions", "valuations", "settings"] as const;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export async function generateMetadata({ params }: PageProps<"/funds/[id]">): Promise<Metadata> {
  const ctx = await requireSession();
  const { id } = await params;
  if (!isFundId(id)) notFound();
  try {
    return { title: (await requireFund(ctx, id)).name };
  } catch (error) {
    if (error instanceof FundError) notFound();
    throw error;
  }
}

/**
 * A fund's page (docs/design/funds-ux.md §5.3, §6, F3; rewrite plan, ux/n6-pension-fund.md §5): the header,
 * the tabs, the period, the Overview and the tabs that follow the period. One page for every fund: a section
 * appears when the fund's configuration calls for it — a payslip source, its due dates, a recurring debit,
 * payments by hand, unit movements — and never by a kind of fund. The period is in the address and stays from
 * the home to the fund and from a tab to the next. "On the way", the recurring debit and the projection stay
 * as of today.
 *
 * The skeleton is a boundary of this page and not a `loading.tsx`: a `loading.tsx` here would also cover the
 * addresses under the fund, and one that does not exist would answer 200 with a skeleton instead of a real 404.
 * The redirects stay above the boundary, so that they are real redirects.
 */
export default async function FundDetailPage({ params, searchParams }: PageProps<"/funds/[id]">) {
  const ctx = await requireSession();
  const { id } = await params;
  // The layout answers 404 too, but this page starts beside it: the database never sees such an id.
  if (!isFundId(id)) notFound();
  const query = (await searchParams) as Query;
  const todayOn = today(ctx.timeZone);
  const base = `${HOME}/${id}`;

  const legacy = legacyFundQuery(query, todayOn);
  if (legacy) permanentRedirect(withParams(base, {}, legacy));
  // The tab of the deposits is the tab of the contributions now: an address saved before still opens it.
  if (one(query.tab) === "deposits") {
    redirect(
      withParams(
        base,
        { ...sectionPeriod(query, todayOn).params, view: one(query.view) },
        { tab: "contributions" },
      ),
    );
  }
  if (isFutureYear(one(query.period), todayOn)) {
    const tab = TABS.find((name) => name === one(query.tab) && name !== "overview");
    redirect(
      withParams(
        base,
        { tab, view: (["value", "return"] as const).find((key) => key === one(query.view)) },
        {},
      ),
    );
  }
  return (
    <Suspense fallback={<FundDetailSkeleton />}>
      <FundDetail ctx={ctx} id={id} query={query} todayOn={todayOn} base={base} />
    </Suspense>
  );
}

async function FundDetail({
  ctx,
  id,
  query,
  todayOn,
  base,
}: {
  ctx: Ctx;
  id: string;
  query: Query;
  todayOn: CivilDate;
  base: string;
}) {
  const t = await getTranslations("funds");
  const th = await getTranslations("funds.home");
  const tf = await getTranslations("funds.fund");
  const tp = await getTranslations("funds.pension");
  const ts = await getTranslations("funds.sources");
  const tPeriod = await getTranslations("investments.period");
  const view = (["value", "return"] as const).find((key) => key === one(query.view)) ?? "gain";
  const row = await fundHomeRow(ctx, id);
  const { detail } = row;
  const tab = TABS.find((name) => name === one(query.tab)) ?? "overview";
  const kept: Params = {
    tab: tab === "overview" ? undefined : tab,
    view: view === "gain" ? undefined : view,
  };

  const { fund, home } = row;
  const period = sectionPeriod(query, todayOn).period;
  const { firstOn, summary, line, beforeFirst } = fundSummary({ fund: home, period, todayOn });
  const span = periodSpan(period, firstOn);
  const periodParams = sectionPeriod(query, todayOn).params;
  const name = periodText(period, span, todayOn, ctx.locale, tPeriod);
  const when =
    period.kind === "year"
      ? th("when.year", { year: period.year! })
      : period.kind === "all"
        ? th("when.all")
        : th("when.custom", {
            from: formatDate(span.from, "long", ctx.locale),
            to: formatDate(span.to, "long", ctx.locale),
          });
  const money = (cents: Cents | null, signed = false) => formatMoney(cents, ctx.numberFormat, { signed });
  const percent = (value: number | null) => formatPercent(value, ctx.numberFormat, { signed: true });
  const long = (date: string | null) => formatDate(date, "long", ctx.locale);
  const day = (date: string | null) => formatDate(date, "dayMonth", ctx.locale);
  const tabHref = (name: string) =>
    withParams(base, periodParams, { tab: name === "overview" ? undefined : name });
  const archived = home.archived;
  const lastLine = detail.valuations[0]
    ? t("valuations.form.last", {
        value: money(detail.valuations[0].valueCents),
        date: long(detail.valuations[0].on),
      })
    : null;

  // ——— What the fund is made of (§5): its sources decide the sections, never a kind of fund ———————
  const { payroll } = detail;
  const withCalendar = hasPayrollCalendar(detail);
  const debit = detail.debits.find((one) => one.source.state === "active") ?? null;
  const byHand = detail.sources.some((source) => source.kind === "manual");
  const label = (year: number, index: number) =>
    periodLabel(payroll?.period ?? "quarter", year, index, ctx.locale, (values) =>
      tf("contributions.register.quarter", values),
    );
  /** The movements a contribution or a recurring debit can be tied to: the last 60 that left an account. */
  const movementsOf = async (accountId: string | null) =>
    (
      await chargeCandidates(ctx, {
        accountId,
        from: fund.startOn,
        to: todayOn,
        types: ["expense", "transfer"],
      })
    )
      .slice(-60)
      .reverse()
      .map((candidate) => ({
        id: candidate.id,
        label: `${formatDate(candidate.on, "dayMonth", ctx.locale)} · ${candidate.payee ?? ""} · ${money(candidate.cents)}`,
      }));
  const movements = archived ? [] : await movementsOf(debit?.source.accountId ?? null);
  const setup = archived ? null : await contributionSetup(ctx, detail, todayOn, movements);
  const recordContribution = (variant: "primary" | "secondary", size: "sm" | "md" | "lg" = "sm") =>
    setup && (
      <ContributionButton setup={setup} label={t("contribution.record")} variant={variant} size={size} />
    );
  const valuationButton = (text: string, place: "page" | "card") => (
    <ValuationButton
      fundId={fund.id}
      fundName={fund.name}
      today={todayOn}
      lastLine={lastLine}
      label={text}
      place={place}
    />
  );

  const header = (
    <div className="flex flex-col gap-1">
      <p data-testid="fund-meta" className="text-sm text-muted">
        {[
          fund.provider,
          detail.compartment ?? fund.compartment,
          t("detail.since", { date: formatDate(fund.startOn, "monthYear", ctx.locale) }),
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex flex-wrap items-center gap-2 text-title font-semibold tracking-title">
          {fund.name}
          {archived && <Badge tone="neutral">{th("list.archived")}</Badge>}
        </h1>
        {/* On a phone the top bar has room for one command: the second sits beside the title (§11.1). */}
        {byHand && <span className="md:hidden">{recordContribution("secondary", "lg")}</span>}
      </div>
    </div>
  );
  const followsPeriod = tab !== "settings";
  const nav = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <TabLinks
        label={t("detail.tabs.label")}
        tabs={TABS.map((name) => ({
          href: tabHref(name),
          label: tf(`tabs.${name}` as "tabs.overview"),
          active: name === tab,
        }))}
      />
      {followsPeriod && (
        <PeriodBar
          period={sectionPeriod(query, todayOn)}
          path={base}
          carry={kept}
          locale={ctx.locale}
          presets={SECTION_PRESETS}
          name={period.kind === "year" ? name : undefined}
          whole={{ range: span, text: name }}
        />
      )}
    </div>
  );

  const shell = (children: React.ReactNode) => (
    <Page
      title={fund.name}
      parent={{ href: withParams(HOME, {}, periodParams), label: t("title") }}
      actions={
        !archived && (
          <span className="flex gap-2">
            {byHand && <span className="max-md:hidden">{recordContribution("secondary")}</span>}
            {valuationButton(tf("recordValue"), "page")}
          </span>
        )
      }
    >
      {header}
      {nav}
      {children}
    </Page>
  );

  // ——— Settings (§6): they do not follow the period ——————————————————————————————————————————————
  if (tab === "settings") {
    const [accounts, taken] = await Promise.all([
      listAccounts(ctx),
      takenComponents(ctx, { fundId: fund.id }),
    ]);
    return shell(
      <FundSettings
        ctx={ctx}
        detail={detail}
        archived={archived}
        todayOn={todayOn}
        accounts={accounts.map((account) => ({ id: account.id, name: account.name }))}
        movements={movements}
        taken={Object.fromEntries(taken)}
        rebuild={<RebuildCompetencesButton fundId={fund.id} label={ts("rebuild")} />}
      />,
    );
  }

  // ——— A year before anything there is (§6) ——————————————————————————————————————————————————————
  const { state } = summary;
  const firstYear = firstOn === null ? Number(todayOn.slice(0, 4)) : Number(firstOn.slice(0, 4));
  const yearHref = (year: number) => withParams(base, kept, yearQuery(year, todayOn));
  if (beforeFirst) {
    return shell(
      <EmptyState
        title={th("noDataTitle", { when })}
        description={th("noDataNote", { date: long(firstOn) })}
        actions={
          <ButtonLink href={yearHref(firstYear)} variant="primary">
            {th("noDataLink", { year: firstYear })}
          </ButtonLink>
        }
      />,
    );
  }

  // ——— The tabs that follow the period (§6): the same lines the Overview reads ——————————————————————
  if (tab === "contributions") {
    return shell(
      <FundContributions
        ctx={ctx}
        detail={detail}
        setup={setup}
        archived={archived}
        period={period}
        when={when}
        settingsHref={tabHref("settings")}
      />,
    );
  }
  if (tab === "valuations") {
    const newest = [...home.points].sort((a, b) => (a.on < b.on ? 1 : -1))[0] ?? null;
    return shell(
      <FundValuations
        ctx={ctx}
        fundId={fund.id}
        archived={archived}
        period={period}
        lines={valuationLines(line, period)}
        recorded={detail.valuations}
        valuesEver={home.points.length}
        lastValue={newest}
        notInValueCents={line.measure.notInValueCents}
        when={when}
        todayOn={todayOn}
        detail={detail}
        updateValue={archived ? null : valuationButton(tf("recordValue"), "card")}
      />,
    );
  }

  // ——— The hero (§6): the same gain and the same return as the fund's row in the home ———————————
  const { measure } = line;
  const measured = line.status === "measured";
  const gainCents = measure.gainCents;
  const noValueYet = !measured && period.to >= todayOn;
  const heroText = measured
    ? money(gainCents, true)
    : noValueYet
      ? th("noValueYet", { when })
      : state === "quiet"
        ? th("noValueIn", { when })
        : th("gainUndetermined");
  const strong = (chunks: React.ReactNode) => (
    <strong className="font-semibold text-fg tabular-nums">{chunks}</strong>
  );
  const heldToday = valueToday([home], todayOn);
  const todayPoint = [...home.points].sort((a, b) => (a.on < b.on ? 1 : -1))[0] ?? null;
  const end = measure.end;
  const past = period.to < todayOn;
  // Units and their price are said only by a fund that has unit movements.
  const hasUnits = detail.movements.length > 0;
  const units = hasUnits ? detail.metrics.units : null;
  const lastPrice = hasUnits ? detail.metrics.lastPrice : null;
  // Today's value beside a past period's, whatever that period could measure (§6).
  const todayPart =
    past && heldToday !== null && todayPoint ? (
      <span data-testid="fund-value-today">
        {tf("hero.today", { value: money(heldToday), date: day(todayPoint.on) })}
      </span>
    ) : null;
  const lastValue =
    end === null
      ? null
      : th.rich("lastValue", {
          value: money(end.cents),
          dates: th("valuesOn", { date: long(end.on) }),
          strong,
        });
  const valuePart: React.ReactNode =
    end === null ? null : !measured || (archived && !past) ? (
      // An archived fund's old value stays in its gain, but it is not money held today, as in the home.
      lastValue
    ) : past ? (
      period.kind === "year" ? (
        tf.rich("hero.valueAtYearEnd", { value: money(end.cents), date: long(end.on), strong })
      ) : (
        tf.rich("hero.valueAtEnd", {
          end: long(period.to),
          value: money(end.cents),
          date: long(end.on),
          strong,
        })
      )
    ) : (
      <>
        {tf.rich("hero.value", { value: money(end.cents), date: long(end.on), strong })}
        {units !== null &&
          ` · ${tf("hero.units", { units: formatDecimalText(units, ctx.numberFormat, { max: 3 }) })}`}
        {lastPrice &&
          ` · ${tf("hero.unitPrice", {
            price: formatDecimalText(lastPrice.price, ctx.numberFormat, { min: 2, max: 4, currency: "EUR" }),
            date: day(lastPrice.on),
          })}`}
      </>
    );
  const valueLine: React.ReactNode =
    valuePart === null && todayPart === null ? null : (
      <>
        {valuePart}
        {valuePart !== null && todayPart !== null && " · "}
        {todayPart}
      </>
    );
  const firstPaidOn = home.flows
    .filter((flow) => flow.chargedCents > 0n)
    .map((flow) => flow.on)
    .sort()[0] as string | undefined;
  const firstValueOn = home.points.map((point) => point.on).sort()[0] as string | undefined;
  const notes = [
    state === "payslips_only"
      ? firstValueOn
        ? th("payslipsNote", { when, date: long(firstValueOn) })
        : th("payslipsNoValue", { when })
      : null,
    state === "paid_no_value" ? th("paidNote", { when }) : null,
    state === "quiet" ? th("quietNote", { when }) : null,
    !archived && !measured && (state === "paid_no_value" || state === "running_no_value")
      ? th("recordToMeasure", { when })
      : null,
    noValueYet && line.status === "never_valued" && payroll !== null && detail.metrics.accruedCents !== 0n
      ? tf("hero.accrued", { amount: money(detail.metrics.accruedCents) })
      : null,
    !measured && end !== null && closesPeriodBefore(end.on, period)
      ? th("closingNote", { date: long(end.on) })
      : null,
    end !== null && measure.notInValueCents > 0n
      ? th("notInValue", { amount: money(measure.notInValueCents) })
      : null,
  ].filter((note) => note !== null);

  // ——— A recurring debit not found, always as of today (§5.2) ————————————————————————————————————
  const alerts = detail.debits.map(({ source, status }) =>
    source.state === "active" && status.kind === "missing" ? (
      <div
        key={source.id}
        data-testid="fund-alert"
        className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-neg/30 bg-neg-bg px-3 py-2 text-sm"
      >
        <p>
          {t("alert.missing", {
            date: formatDate(status.by, "long", ctx.locale),
            amount: money(source.amountCents),
          })}
        </p>
        <Link
          href="/expenses"
          className="focus-ring inline-flex min-h-6 shrink-0 items-center rounded-xs font-medium text-accent hover:underline"
        >
          {t("alert.cta")}
        </Link>
      </div>
    ) : null,
  );

  // ——— On the way, always as of today (§5.3) ————————————————————————————————————————————————————
  const onTheWay =
    withCalendar && row.onTheWay.length > 0 ? (
      <p
        data-testid="fund-on-the-way"
        data-cents={String(row.onTheWayCents)}
        className="rounded-card border border-border bg-card px-3 py-2 text-sm"
      >
        {tp("notice.pending", {
          amount: money(row.onTheWayCents),
          quarters: row.onTheWay
            .map((pending) =>
              tp("notice.pendingQuarter", {
                quarter: label(pending.year, pending.quarter),
                amount: money(pending.cents),
                date: long(pending.due),
              }),
            )
            .join("; "),
        })}{" "}
        <Link
          href={tabHref("contributions")}
          className="focus-ring inline-flex min-h-6 items-center rounded-sm font-medium text-accent hover:underline"
        >
          {tf("onTheWay.link")}
        </Link>
      </p>
    ) : null;

  // ——— The KPIs (§5.3) ———————————————————————————————————————————————————————————————————————————
  const paidLabel =
    period.kind === "year"
      ? th("kpis.paidInYear", { year: period.year! })
      : period.kind === "all"
        ? th("kpis.paidIn")
        : th("kpis.paidInPeriod");
  const { origin } = summary;
  const operations = detail.operations.filter((operation) => inPeriod(operation.operationDate, period));
  /** Of whom the money is, the empty parts left out: "you 80,00 € · employer 60,00 €". */
  const originText = (parts: ReturnType<typeof originParts>) =>
    parts.map((part) => th(`kpis.originParts.${part.key}`, { amount: money(part.cents) })).join(" · ");
  const nothingPaid =
    firstPaidOn && firstPaidOn > period.to
      ? th("kpis.paidInFirst", { date: long(firstPaidOn) })
      : th("kpis.nothingPaid");
  const paidNote =
    measure.paidInCents === 0n ? nothingPaid : originText(originParts(origin, voluntaryCents(operations)));
  const pill = debit
    ? monthPill(debit.status, ctx.locale, {
        found: (date) => t("month.found", { date }),
        awaited: t("month.awaited"),
        missing: t("month.missing"),
        none: t("month.none"),
      })
    : null;
  const debitNote = () => {
    if (!debit || !pill) return undefined;
    const frequency = frequencyText(ts, debit.plan.frequency.count, debit.plan.frequency.unit);
    const { day: debitDay } = debit.plan;
    if (debitDay !== null && debit.status.kind !== "none")
      return ts("debit.kpiNote", { frequency, day: debitDay, status: pill.text });
    if (debitDay !== null) return tf("kpis.debitDay", { frequency, day: debitDay });
    return debit.status.kind === "none" ? frequency : `${frequency} · ${pill.text}`;
  };
  const tiles = [
    <Kpi key="paid" testId="kpi-paid" label={paidLabel} value={money(summary.paidInCents)} note={paidNote} />,
    <Kpi
      key="market"
      testId="kpi-market"
      label={th("kpis.market")}
      value={summary.marketCents === null ? NULL_DISPLAY : money(summary.marketCents, true)}
      tone={toneOfSign(summary.marketCents)}
      note={summary.marketCents === null ? th("kpis.marketNeedsValue") : th("kpis.marketNote")}
    />,
    <Kpi
      key="fees"
      testId="kpi-fees"
      label={th("kpis.fees")}
      value={money(-summary.feesCents, summary.feesCents !== 0n)}
      note={
        summary.feesPartial
          ? th("kpis.feesUnknown")
          : summary.paidInCents === 0n && summary.feesCents === 0n
            ? th("kpis.nothingPaid")
            : th("kpis.feesNote")
      }
    />,
    debit && (
      <Kpi
        key="debit"
        testId="kpi-debit"
        label={ts("debit.kpi")}
        value={debit.source.amountCents === null ? NULL_DISPLAY : money(debit.source.amountCents)}
        note={debitNote()}
      />
    ),
    state === "payslips_only" && (
      <Kpi
        key="accrued"
        testId="kpi-accrued"
        label={th("kpis.accrued")}
        value={money(summary.accruedCents)}
      />
    ),
  ].filter((tile) => tile !== null && tile !== false);
  // Three tiles in three columns, four in four; five wrap as two and three. On a phone they are two by
  // two, and the last of an odd number takes the whole row (§5.2, §11.1).
  const kpis = (
    <div
      className={cn(
        "grid grid-cols-2 gap-4",
        tiles.length === 3 && "@4xl:grid-cols-3",
        tiles.length === 4 && "@4xl:grid-cols-4",
        tiles.length === 5 && "@4xl:grid-cols-6",
      )}
    >
      {tiles.map((tile, index) => (
        <div
          key={tile.key}
          className={cn(
            "grid min-w-0",
            tiles.length % 2 === 1 && index === tiles.length - 1 && "col-span-2",
            tiles.length === 3 && "@4xl:col-span-1",
            tiles.length === 5 && (index < 2 ? "@4xl:col-span-3" : "@4xl:col-span-2"),
          )}
        >
          {tile}
        </div>
      ))}
    </div>
  );

  const color = colorFor({ color: row.color }, 0);
  const performance =
    state === "payslips_only" ? (
      <Card data-testid="payslips-only" className="flex flex-col items-start gap-3">
        <h2 className="text-lg font-semibold">{th("chart.empty", { when })}</h2>
        <div className="flex flex-wrap gap-2">
          {period.kind === "year" && firstPaidOn !== undefined && (
            <ButtonLink
              href={yearHref(Math.min(period.year! + 1, Number(todayOn.slice(0, 4))))}
              variant="primary"
              size="sm"
            >
              {th("goToYear", { year: Math.min(period.year! + 1, Number(todayOn.slice(0, 4))) })}
            </ButtonLink>
          )}
          <ButtonLink href={tabHref("contributions")} variant="ghost" size="sm">
            {period.kind === "year" ? th("openContributions", { year: period.year! }) : th("chart.data")}
          </ButtonLink>
        </div>
      </Card>
    ) : (
      <FundChart
        ctx={ctx}
        lines={[line]}
        colorOf={() => color}
        bySign
        period={period}
        span={span}
        when={when}
        totalCents={gainCents}
        rate={measure.rate}
        view={view}
        path={base}
        params={periodParams}
        gainNote={(grain) => tf(`chartNote.${grain}`, { when })}
      />
    );

  // ——— The money of the period (§6): the last lines of the register ————————————————————————————————
  // A change of compartment moves no money, so only its cost is a line: it stays in the fees.
  const recent = operations
    .filter((operation) => operationGross(operation) !== 0n)
    .reverse()
    .slice(0, 5);
  const firstStep = !archived && detail.operations.length === 0 && detail.competences.length === 0;
  const recentCard = (
    <Card padded={false} className="min-w-0" data-testid="fund-recent">
      <CardHeader
        title={tf("recent.title")}
        actions={
          <Link
            href={tabHref("contributions")}
            className="focus-ring inline-flex min-h-6 items-center rounded-xs text-sm text-accent hover:underline"
          >
            {tf("recent.allContributions")}
          </Link>
        }
      />
      {recent.length === 0 ? (
        <div className="flex flex-col items-start gap-2 px-4 pb-4 text-sm">
          <p className="text-muted">{tf("recent.empty")}</p>
          {firstStep && recordContribution("secondary")}
        </div>
      ) : (
        <ul className="flex flex-col">
          {recent.map((operation) => {
            const competence =
              operation.competenceYear === null || operation.competenceQuarter === null
                ? null
                : label(operation.competenceYear, operation.competenceQuarter);
            const contribution = operation.classification === "contribution";
            return (
              <li
                key={operation.id}
                data-testid="recent-flow"
                className="flex items-start justify-between gap-3 border-t border-border px-4 py-2.5"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="font-medium">{competence ?? day(operation.operationDate)}</span>
                    <Badge tone="neutral">
                      {tf(`contributions.register.origins.${operationOrigin(operation, detail.sources)}`)}
                    </Badge>
                  </span>
                  <span className="text-sm text-muted tabular-nums">
                    {[
                      competence ? day(operation.operationDate) : null,
                      contribution
                        ? originText(
                            originParts(
                              {
                                youCents: operation.workerCents,
                                employerCents: operation.employerCents,
                                tfrCents: operation.tfrCents,
                                otherCents: operation.otherCents,
                              },
                              0n,
                            ),
                          )
                        : operation.classification === "voluntary"
                          ? null
                          : tp(`classes.${operation.classification}`),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-0.5 text-right tabular-nums">
                  <span className="font-semibold">{money(operationGross(operation))}</span>
                  {!operation.feesUnknown && operation.feesCents !== 0n && (
                    <span className="text-sm text-muted">
                      {tf("recent.fee", { amount: money(-operation.feesCents) })}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );

  const bridgeCard = payroll !== null && (
    <Card className="flex min-w-0 flex-col gap-3" data-testid="fund-bridge">
      <h2 className="text-lg font-semibold">{tf("bridge.title")}</h2>
      {detail.bridge === null ? (
        <p className="text-sm text-muted">{tf("bridgeNoValue")}</p>
      ) : (
        <>
          <dl className="flex flex-col gap-1 text-sm">
            {detail.bridge.map((bridgeLine) => (
              <div
                key={bridgeLine.key}
                className={cn(
                  "flex items-baseline justify-between gap-3",
                  bridgeLine.total && "border-t border-border pt-1 font-semibold",
                )}
              >
                <dt>
                  {bridgeLine.key === "value"
                    ? tf("bridgeValue")
                    : tp(`bridge.lines.${bridgeLine.key}` as "bridge.lines.accrued")}
                </dt>
                <dd className="tabular-nums">{money(bridgeLine.cents, !bridgeLine.total)}</dd>
              </div>
            ))}
          </dl>
          <p className="text-sm text-muted">
            {tf("bridge.note", { date: long(detail.metrics.value?.on ?? null) })}
          </p>
        </>
      )}
    </Card>
  );

  // ——— The projection (§5.2): short for a fund fed by a recurring debit alone, closed otherwise ————
  const shortProjection = debit !== null && payroll === null;
  const forecast = hypothesesOnly(detail.forecast);
  // A fund with nothing in it yet: the two things to do first, in one card (§10.5).
  const firstSteps = firstStep && home.points.length === 0;

  return shell(
    <>
      <section aria-labelledby="fund-gain" className="flex min-w-0 flex-col gap-1">
        <h2 id="fund-gain" className="text-sm font-medium text-muted">
          {th("gainTitle", { period: name })}
        </h2>
        <p
          data-testid="funds-hero"
          data-state={state}
          data-cents={gainCents === null ? "" : String(gainCents)}
          className="flex flex-wrap items-baseline gap-x-3"
        >
          <span
            className={cn(
              "text-hero leading-tight font-semibold tracking-title tabular-nums",
              TONE_TEXT[toneOfSign(gainCents)],
            )}
          >
            {heroText}
          </span>
          {measure.rate !== null && (
            <span
              data-testid="funds-rate"
              title={
                measure.xirr?.status === "ok"
                  ? th("list.xirr", { rate: percent(measure.xirr.rate) })
                  : undefined
              }
              className={cn("text-lg font-semibold tabular-nums", TONE_TEXT[toneOfSign(measure.rate)])}
            >
              {percent(measure.rate)}
            </span>
          )}
        </p>
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
        {(noValueYet || (!measured && state === "paid_no_value")) && !archived && !firstSteps && (
          <div className="pt-1">
            {valuationButton(line.status === "never_valued" ? th("list.first") : tf("recordValue"), "card")}
          </div>
        )}
      </section>
      {firstSteps && (
        <Card data-testid="fund-first-steps" className="flex min-w-0 flex-col items-start gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold">{tf("firstSteps.title")}</h2>
            <p className="text-sm text-muted">{tf("firstSteps.text")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {recordContribution("primary")}
            {valuationButton(tf("recordValue"), "card")}
          </div>
        </Card>
      )}
      {alerts}
      {onTheWay}
      {kpis}
      {performance}
      {shortProjection || bridgeCard ? (
        <div className="grid min-w-0 items-start gap-4 @4xl:grid-cols-2">
          {recentCard}
          {bridgeCard}
          {shortProjection && (
            <ShortProjection
              ctx={ctx}
              forecast={forecast}
              plan={fund.state === "active" && debit.source.amountCents !== null}
            />
          )}
        </div>
      ) : (
        recentCard
      )}
      {!shortProjection && <ClosedProjection ctx={ctx} forecast={forecast} />}
    </>,
  );
}

export const dynamic = "force-dynamic";
