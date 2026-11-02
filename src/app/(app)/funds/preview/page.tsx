import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { listAccounts } from "@/modules/accounts/queries";
import { LinkTabs } from "@/modules/accounts/ui/controls";
import { asNumbers, axisLabels, colorFor } from "@/modules/accounts/ui/display";
import {
  firstDataOn,
  type FundLine,
  gainBars,
  gainGrain,
  homeSummary,
  isFutureYear,
  lineValue,
  staleFunds,
  valueSeries,
  valueToday,
  yearRows,
} from "@/modules/funds/home";
import { fundsHomeRows } from "@/modules/funds/home-queries";
import { fundsHomePreview } from "@/modules/funds/preview";
import { valuationAccountOptions } from "@/modules/funds/queries";
import { FundStateButton, NewFundButton, ValuationButton } from "@/modules/funds/ui/fund-forms";
import { monthPill, newFundDraft } from "@/modules/funds/ui/present";
import { legacyPeriodQuery, periodQuery, periodSpan, type Query } from "@/modules/investments/period";
import { periodOf } from "@/modules/investments/pnl";
import { bestAndWorst, runningTotal, sampled, toCents } from "@/modules/investments/ui/chart-data";
import { PeriodControl, periodText } from "@/modules/investments/ui/period-control";
import { requireSession } from "@/platform/auth/session";
import { today } from "@/platform/dates";
import { formatDate, formatMoney, formatPercent, NULL_DISPLAY } from "@/platform/format";
import type { Cents } from "@/platform/money";
import { Badge } from "@/ui/badge";
import { ButtonLink } from "@/ui/button";
import { Card, CardHeader } from "@/ui/card";
import { CompositionBar, MultiLine, StackedBars, stackLayers } from "@/ui/chart";
import { cn } from "@/ui/cn";
import { HighlightScope, SeriesToggle } from "@/ui/highlight";
import { Popover } from "@/ui/popover";
import { ProgressBar } from "@/ui/progress-bar";
import { Page } from "@/ui/shell/page";
import { EmptyState } from "@/ui/states";
import { Table, TBody, Td, Th, THead, TotalRow, Tr } from "@/ui/table";
import { type Tone, TONE_TEXT, toneOfSign } from "@/ui/tone";
import { type Params, withParams } from "@/ui/url";
import { createPensionFundAction } from "../pension-setup";

const PATH = "/funds/preview";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("funds"))("title") };
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** A KPI whose note wraps: the tiles here explain their number, and a cut note explains nothing. */
function Kpi({
  label,
  value,
  tone = "fg",
  note,
  testId,
}: {
  label: string;
  value: string;
  tone?: Tone;
  note?: string;
  testId?: string;
}) {
  return (
    <Card className="flex min-w-0 flex-col gap-1.5" data-testid={testId}>
      <span className="text-sm font-medium text-muted">{label}</span>
      <span className={cn("text-kpi font-semibold tracking-[-0.02em] tabular-nums", TONE_TEXT[tone])}>
        {value}
      </span>
      {note && <span className="text-sm text-muted">{note}</span>}
    </Card>
  );
}

/**
 * Funds · the new home (docs/design/funds-ux.md §5.3, §6, F2, mockups a-01 to a-04): the gain of the
 * period first, then what explains it, the chart, the funds, and who paid in. The period is in the
 * address and drives every number here but "On the way" and the plan, which stay as of today. Not
 * connected yet: `layout.tsx` answers 404 on the deployed site, and F5 moves this page to /funds.
 */
export default async function FundsHomePage({ searchParams }: PageProps<"/funds/preview">) {
  if (!fundsHomePreview()) notFound();
  const ctx = await requireSession();
  const t = await getTranslations("funds");
  const th = await getTranslations("funds.home");
  const tp = await getTranslations("investments.period");
  const query = (await searchParams) as Query;
  const todayOn = today(ctx.timeZone);

  const legacy = legacyPeriodQuery(query, todayOn);
  if (legacy) permanentRedirect(withParams(PATH, {}, legacy));
  const view = one(query.view) === "value" ? "value" : "gain";
  const kept: Params = { view: view === "gain" ? undefined : view };
  if (isFutureYear(one(query.period), todayOn)) redirect(withParams(PATH, kept, {}));

  const [rows, accounts, valuationAccounts] = await Promise.all([
    fundsHomeRows(ctx),
    listAccounts(ctx),
    valuationAccountOptions(ctx),
  ]);
  const add = (label: string, size: "sm" | "md" = "sm") => (
    <NewFundButton
      draft={newFundDraft(todayOn)}
      accounts={accounts.map((account) => ({ id: account.id, name: account.name }))}
      valuationAccounts={valuationAccounts}
      createPension={createPensionFundAction}
      label={label}
      size={size}
    />
  );
  const archived = rows.filter((row) => row.home.archived);
  const open = rows.filter((row) => !row.home.archived);
  const archivedList =
    archived.length > 0 ? (
      <details className="text-sm">
        <summary className="focus-ring inline-flex min-h-6 cursor-pointer items-center rounded-[4px] text-muted">
          {t("archived.count", { count: archived.length })}
        </summary>
        <ul className="mt-2 flex flex-col gap-1">
          {archived.map(({ fund }) => (
            <li key={fund.id} className="flex items-center justify-between gap-2">
              <Link
                href={`/funds/${fund.id}` as Route}
                className="focus-ring inline-flex min-h-6 items-center rounded-[4px] hover:underline"
              >
                {fund.name}
              </Link>
              <FundStateButton
                fundId={fund.id}
                state="active"
                label={t("archived.restore")}
                toast={t("toasts.restored")}
              />
            </li>
          ))}
        </ul>
      </details>
    ) : null;

  if (rows.length === 0) {
    return (
      <Page title={t("title")} actions={add(t("add"))}>
        <h1 className="text-title font-semibold tracking-[-0.02em] max-md:sr-only">{t("title")}</h1>
        <EmptyState
          title={t("empty.title")}
          description={t("empty.description")}
          actions={add(t("empty.cta"), "md")}
        />
      </Page>
    );
  }

  // ——— The period (§6) ————————————————————————————————————————————————————————————————————————
  const funds = rows.map((row) => row.home);
  const firstOn = firstDataOn(funds);
  const period = periodOf({ period: one(query.period), from: one(query.from), to: one(query.to) }, todayOn);
  const span = periodSpan(period, firstOn);
  const summary = homeSummary({ funds, period, todayOn, firstOn });
  const name = periodText(period, span, todayOn, ctx.locale, tp);
  const when =
    period.kind === "year"
      ? th("when.year", { year: period.year! })
      : period.kind === "all"
        ? th("when.all")
        : th("when.custom", {
            from: formatDate(span.from, "long", ctx.locale),
            to: formatDate(span.to, "long", ctx.locale),
          });
  const periodParams = periodQuery(period, todayOn);
  const thisYear = Number(todayOn.slice(0, 4));
  const money = (cents: Cents | null, signed = false) => formatMoney(cents, ctx.numberFormat, { signed });
  const percent = (value: number | null, signed = true) => formatPercent(value, ctx.numberFormat, { signed });
  const day = (date: string | null) => formatDate(date, "dayMonth", ctx.locale);

  const rowOf = new Map(rows.map((row) => [row.fund.id, row]));
  const colorOf = (id: string) => {
    const index = rows.findIndex((row) => row.fund.id === id);
    return colorFor({ color: rows[index].color }, index);
  };
  /** Most gain first, the funds with none after them: the order of the chart's stack, reversed. */
  const lines = [...summary.lines].sort((a, b) => {
    const left = a.measure.gainCents;
    const right = b.measure.gainCents;
    if (left === right) return a.fund.name < b.fund.name ? -1 : 1;
    if (left === null) return 1;
    if (right === null) return -1;
    return left > right ? -1 : 1;
  });

  const { state } = summary;
  const firstOpen = open[0] ?? null;
  const missing = open.filter((row) => row.month.kind === "missing");
  const stale = staleFunds(
    open.map((row) => row.home),
    todayOn,
  );
  const onTheWayCents = open.reduce<Cents>((sum, row) => sum + row.onTheWayCents, 0n);
  const hasPension = open.some((row) => row.fund.type === "pension");
  const firstYear = firstOn === null ? thisYear : Number(firstOn.slice(0, 4));
  const firstValueOn = funds.flatMap((fund) => fund.points.map((point) => point.on)).sort()[0] as
    string | undefined;
  const firstPaidOn = funds
    .flatMap((fund) => fund.flows.filter((flow) => flow.chargedCents > 0n).map((flow) => flow.on))
    .sort()[0] as string | undefined;
  const yearHref = (year: number) =>
    withParams(PATH, kept, year === thisYear ? {} : { period: String(year) }) as Route;

  const pageHeader = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-title font-semibold tracking-[-0.02em] max-md:sr-only">{t("title")}</h1>
      <PeriodControl
        period={period}
        span={span}
        todayOn={todayOn}
        firstOn={firstOn}
        path={PATH}
        params={kept}
        locale={ctx.locale}
        t={tp}
      />
    </div>
  );

  const alerts =
    missing.length > 0 ? (
      <section className="flex flex-col gap-2">
        {missing.map(({ fund, month }) => (
          <div
            key={fund.id}
            data-testid="fund-alert"
            className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-neg/30 bg-neg-bg px-3 py-2 text-sm"
          >
            <p>
              <strong className="font-semibold">{fund.name}</strong> —{" "}
              {t("alert.missing", {
                date: month.kind === "missing" ? formatDate(month.by, "long", ctx.locale) : "",
                amount: money(fund.monthlyCents),
              })}
            </p>
            <Link
              href="/expenses"
              className="focus-ring inline-flex min-h-6 shrink-0 items-center rounded-[2px] font-medium text-accent hover:underline"
            >
              {t("alert.cta")}
            </Link>
          </div>
        ))}
      </section>
    ) : null;

  // ——— A year before anything there is: no number to show (§6) ———————————————————————————————
  if (state === "before_first") {
    return (
      <Page title={t("title")} actions={add(t("add"))}>
        {alerts}
        {pageHeader}
        <EmptyState
          title={th("noDataTitle", { when })}
          description={th("noDataNote", { date: formatDate(firstOn, "long", ctx.locale) })}
          actions={
            <ButtonLink href={yearHref(firstYear)} variant="primary">
              {th("noDataLink", { year: firstYear })}
            </ButtonLink>
          }
        />
        {archivedList}
      </Page>
    );
  }

  // ——— The hero (§6) —————————————————————————————————————————————————————————————————————————
  const heroCents = summary.gainCents;
  const heroText =
    heroCents !== null
      ? money(heroCents, true)
      : state === "running_no_value"
        ? th("noValueYet", { when })
        : state === "quiet"
          ? th("noValueIn", { when })
          : th("gainUndetermined");
  const unmeasured = summary.lines.filter((line) => line.status !== "measured").length;
  const notes = [
    state === "partial" ? th("partialNote", { count: unmeasured }) : null,
    state === "payslips_only"
      ? firstValueOn
        ? th("payslipsNote", { when, date: formatDate(firstValueOn, "long", ctx.locale) })
        : th("payslipsNoValue", { when })
      : null,
    state === "paid_no_value" ? th("paidNote", { when }) : null,
    state === "quiet" ? th("quietNote", { when }) : null,
    state === "paid_no_value" || state === "running_no_value" ? th("recordToMeasure", { when }) : null,
    summary.notInValueCents > 0n ? th("notInValue", { amount: money(summary.notInValueCents) }) : null,
  ].filter((note) => note !== null);
  const strong = (chunks: React.ReactNode) => (
    <strong className="font-semibold text-fg tabular-nums">{chunks}</strong>
  );
  const seenCount = summary.lines.filter((line) => lineValue(line, period, todayOn) !== null).length;
  const dates =
    summary.valueFrom === null
      ? ""
      : summary.valueFrom === summary.valueTo
        ? th("valuesOn", { date: day(summary.valueFrom) })
        : th("valuesBetween", { from: day(summary.valueFrom), to: day(summary.valueTo) });
  const datesLong =
    summary.valueFrom === summary.valueTo
      ? th("valuesOn", { date: formatDate(summary.valueTo, "long", ctx.locale) })
      : th("valuesBetween", {
          from: formatDate(summary.valueFrom, "long", ctx.locale),
          to: formatDate(summary.valueTo, "long", ctx.locale),
        });
  const measuredAny = state === "measured" || state === "partial";
  const valueLine =
    summary.valueCents === null
      ? null
      : !measuredAny
        ? th.rich("lastValue", {
            value: money(summary.valueCents),
            dates: datesLong,
            strong,
          })
        : period.to < todayOn
          ? th.rich("valueAtEnd", {
              date: formatDate(period.to, "long", ctx.locale),
              value: money(summary.valueCents),
              dates,
              today: money(valueToday(funds, todayOn)),
              strong,
            })
          : th.rich("valueLine", {
              value: money(summary.valueCents),
              count: seenCount,
              dates,
              strong,
            });

  const staleLink =
    stale.length === 1 ? (
      <Link
        href={`/funds/${stale[0].fund.id}` as Route}
        className="focus-ring inline-flex min-h-6 items-center gap-1.5 rounded-[4px] text-sm hover:underline"
      >
        <Badge tone="warn">1</Badge>
        {th("stale.one", { name: stale[0].fund.name, date: day(stale[0].lastOn) })}
      </Link>
    ) : stale.length > 1 ? (
      <Popover
        triggerLabel={th("stale.label", { count: stale.length })}
        trigger={
          <>
            <Badge tone="warn">{stale.length}</Badge>
            {th("stale.many", { count: stale.length })}
          </>
        }
      >
        <ul className="flex max-w-80 flex-col">
          {stale.map(({ fund, lastOn }) => (
            <li key={fund.id}>
              <Link
                href={`/funds/${fund.id}` as Route}
                className="focus-ring flex min-h-8 items-center rounded-[4px] px-2 text-sm hover:bg-hover"
              >
                {th("stale.one", { name: fund.name, date: day(lastOn) })}
              </Link>
            </li>
          ))}
        </ul>
      </Popover>
    ) : null;

  const firstValueFund =
    open.find(
      (row) => !summary.lines.some((line) => line.fund.id === row.fund.id && line.status === "measured"),
    ) ?? firstOpen;
  const recordValue =
    (state === "paid_no_value" || state === "running_no_value") && firstValueFund ? (
      <ValuationButton
        fundId={firstValueFund.fund.id}
        fundName={firstValueFund.fund.name}
        today={todayOn}
        lastLine={null}
        label={t("table.valuation")}
      />
    ) : null;

  // ——— The KPIs (§5.3) ———————————————————————————————————————————————————————————————————————
  const paidLabel =
    period.kind === "year"
      ? th("kpis.paidInYear", { year: period.year! })
      : period.kind === "all"
        ? th("kpis.paidIn")
        : th("kpis.paidInPeriod");
  const { origin } = summary;
  const paidNote =
    summary.paidInCents === 0n
      ? firstPaidOn && firstPaidOn > period.to
        ? th("kpis.paidInFirst", { date: formatDate(firstPaidOn, "long", ctx.locale) })
        : th("kpis.nothingPaid")
      : th(origin.otherCents === 0n ? "kpis.origin" : "kpis.originOther", {
          you: money(origin.youCents),
          employer: money(origin.employerCents),
          tfr: money(origin.tfrCents),
          other: money(origin.otherCents),
        });
  const accruedFund = summary.lines.find((line) => line.accruedCents !== 0n)?.fund ?? null;
  const accruedDue = accruedFund?.accrued
    .filter((line) => line.on >= span.from && line.on <= span.to)
    .map((line) => line.dueOn)
    .filter((due) => due !== null)
    .sort()
    .at(-1);
  const kpis = (
    <div
      className={cn(
        "grid grid-cols-2 gap-4",
        state === "payslips_only" || hasPension ? "@4xl:grid-cols-4" : "@4xl:grid-cols-3",
      )}
    >
      <Kpi testId="kpi-paid" label={paidLabel} value={money(summary.paidInCents)} note={paidNote} />
      <Kpi
        testId="kpi-market"
        label={th("kpis.market")}
        value={summary.marketCents === null ? NULL_DISPLAY : money(summary.marketCents, true)}
        tone={toneOfSign(summary.marketCents)}
        note={summary.marketCents === null ? th("kpis.marketNeedsValue") : th("kpis.marketNote")}
      />
      <Kpi
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
      />
      {state === "payslips_only" ? (
        <Kpi
          testId="kpi-accrued"
          label={th("kpis.accrued")}
          value={money(summary.accruedCents)}
          note={
            accruedFund && accruedDue
              ? th("kpis.accruedNote", {
                  name: accruedFund.name,
                  date: formatDate(accruedDue, "monthYear", ctx.locale),
                })
              : undefined
          }
        />
      ) : (
        hasPension && (
          <Kpi
            testId="kpi-on-the-way"
            label={th("kpis.onTheWay")}
            value={money(onTheWayCents)}
            note={th("kpis.onTheWayNote")}
          />
        )
      )}
    </div>
  );

  // ——— The chart (§6) ——————————————————————————————————————————————————————————————————————————
  const grain = gainGrain(period, span);
  const bars = gainBars(summary.lines, span, grain);
  const stack = [...lines].reverse();
  const totals = bars.map((bar) => bar.totalCents);
  const cumulative = runningTotal(totals);
  const barName = (index: number) => {
    const bar = bars[index];
    if (grain === "year") return bar.from.slice(0, 4);
    if (grain === "month") return formatDate(bar.from, "monthYear", ctx.locale);
    return th("chart.stretch", { from: day(bar.from), to: day(bar.to) });
  };
  const barLabels = sampled(bars.length).map((index) =>
    grain === "year"
      ? bars[index].from.slice(0, 4)
      : grain === "month"
        ? formatDate(bars[index].from, "month", ctx.locale)
        : day(bars[index].to),
  );
  const extremes = bestAndWorst(totals);
  const gainSummary = th("chart.summary", {
    when,
    total: heroCents === null ? NULL_DISPLAY : money(heroCents, true),
    best: extremes ? `${barName(extremes.best)} (${money(totals[extremes.best], true)})` : NULL_DISPLAY,
    worst: extremes ? `${barName(extremes.worst)} (${money(totals[extremes.worst], true)})` : NULL_DISPLAY,
    funds: lines
      .filter((line) => line.status === "measured")
      .map((line) => `${line.fund.name} ${money(line.measure.gainCents, true)}`)
      .join(", "),
  });
  const layerValues = stack.map((line) => asNumbers(bars.map((bar) => bar.byFund.get(line.fund.id) ?? null)));
  const layers = stackLayers(layerValues, bars.length);
  const series = valueSeries(summary.lines);
  const seriesValues = series.map((point) => point.valueCents);
  const seriesPaid = series.map((point) => point.paidCents);
  const lastPoint = series.at(-1);

  const chartBody =
    view === "gain" ? (
      totals.every((cents) => cents === null) ? (
        <p data-testid="chart-empty" className="text-sm text-muted">
          {th("chart.empty", { when })}
        </p>
      ) : (
        <StackedBars
          layers={stack.map((line, index) => ({
            key: line.fund.id,
            label: line.fund.name,
            color: colorOf(line.fund.id),
            values: layerValues[index],
          }))}
          line={asNumbers(cumulative)}
          yLabels={axisLabels(
            [...cumulative, ...layers.top.map(toCents), ...layers.bottom.map(toCents)],
            ctx.numberFormat,
            4,
          )}
          xLabels={barLabels}
          hover={bars.map((bar, index) => ({
            label: barName(index),
            value: money(totals[index], true),
            note: th("chart.cumulative", { amount: money(cumulative[index], true) }),
            rows: bar.stretches.map((stretch) => ({
              label: `${rowOf.get(stretch.fundId)?.fund.name ?? ""} · ${th("chart.stretch", {
                from: day(stretch.from),
                to: day(stretch.to),
              })}`,
              value: money(stretch.gainCents, true),
              color: colorOf(stretch.fundId),
            })),
          }))}
          summary={gainSummary}
        />
      )
    ) : series.length < 2 ? (
      <p data-testid="chart-empty" className="text-sm text-muted">
        {series.length === 0 ? th("chart.empty", { when }) : th("chart.emptyValue")}
      </p>
    ) : (
      <MultiLine
        series={[
          { values: asNumbers(seriesValues), color: "var(--accent)", step: true },
          { values: asNumbers(seriesPaid), color: "var(--muted)", dashed: true, step: true },
        ]}
        band={{ upper: asNumbers(seriesValues), lower: asNumbers(seriesPaid) }}
        yLabels={axisLabels([...seriesValues, ...seriesPaid], ctx.numberFormat, 4)}
        xLabels={sampled(series.length).map((index) =>
          series[0].on.slice(0, 4) === lastPoint?.on.slice(0, 4)
            ? day(series[index].on)
            : formatDate(series[index].on, "long", ctx.locale),
        )}
        hover={series.map((point) => ({
          label: formatDate(point.on, "long", ctx.locale),
          value: money(point.valueCents),
          note: th("chart.paidRow", { amount: money(point.paidCents) }),
          rows: [
            {
              label: th("chart.gain"),
              value: money(point.valueCents - point.paidCents, true),
              color: "var(--pos)",
            },
          ],
        }))}
        summary={th("chart.valueSummary", {
          when,
          value: money(lastPoint?.valueCents ?? null),
          date: formatDate(lastPoint?.on ?? null, "long", ctx.locale),
          paid: money(lastPoint?.paidCents ?? null),
        })}
        height={200}
      />
    );

  const contributionsFund = accruedFund;
  const chartCard =
    state === "payslips_only" ? (
      <Card data-testid="payslips-only" className="flex flex-col items-start gap-3">
        <h2 className="text-lg font-semibold">{th("chart.empty", { when })}</h2>
        <div className="flex flex-wrap gap-2">
          {period.kind === "year" && firstPaidOn !== undefined && (
            <ButtonLink href={yearHref(Math.min(period.year! + 1, thisYear))} variant="primary" size="sm">
              {th("goToYear", { year: Math.min(period.year! + 1, thisYear) })}
            </ButtonLink>
          )}
          {contributionsFund && (
            <ButtonLink
              href={`/funds/${contributionsFund.id}?tab=contributions` as Route}
              variant="ghost"
              size="sm"
            >
              {period.kind === "year" ? th("openContributions", { year: period.year! }) : th("chart.data")}
            </ButtonLink>
          )}
        </div>
      </Card>
    ) : (
      <Card className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="text-lg font-semibold">{th("chart.title")}</h2>
            <p className="text-sm text-muted">
              {view === "gain" ? th(`chart.gainNote.${grain}`, { when }) : th("chart.valueNote")}
            </p>
          </div>
          <LinkTabs
            label={th("chart.view")}
            path={PATH}
            params={periodParams}
            name="view"
            current={view}
            options={[
              { value: "gain", label: th("chart.gain") },
              { value: "value", label: th("chart.value") },
            ]}
          />
        </div>
        {chartBody}
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
          {view === "gain" ? (
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-0.5 w-4 bg-fg" /> {th("chart.line")}
            </span>
          ) : (
            <>
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="h-0.5 w-4 bg-accent" /> {th("chart.value")}
              </span>
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="w-4 border-t border-dashed border-muted" /> {th("chart.paid")}
              </span>
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="size-2.5 rounded-[2px] bg-pos-bg" /> {th("chart.band")}
              </span>
            </>
          )}
        </p>
        {view === "gain" && totals.some((cents) => cents !== null) && (
          <details className="text-sm">
            <summary className="focus-ring inline-flex min-h-6 cursor-pointer items-center rounded-[4px] text-muted hover:text-fg">
              {th("chart.data")}
            </summary>
            <Table className="mt-2">
              <THead>
                <Th>{th("chart.interval")}</Th>
                <Th align="right">{th("chart.gain")}</Th>
                <Th align="right">{th("chart.cumulativeHeader")}</Th>
              </THead>
              <TBody>
                {bars.map((bar, index) => (
                  <Tr key={bar.from + bar.to}>
                    <Td>{barName(index)}</Td>
                    <Td align="right" className={TONE_TEXT[toneOfSign(totals[index])]}>
                      {money(totals[index], true)}
                    </Td>
                    <Td align="right">{money(cumulative[index], true)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </details>
        )}
        {view === "value" && series.length >= 2 && (
          <details className="text-sm">
            <summary className="focus-ring inline-flex min-h-6 cursor-pointer items-center rounded-[4px] text-muted hover:text-fg">
              {th("chart.data")}
            </summary>
            <Table className="mt-2">
              <THead>
                <Th>{th("chart.dateHeader")}</Th>
                <Th align="right">{th("chart.valueHeader")}</Th>
                <Th align="right">{th("chart.paid")}</Th>
              </THead>
              <TBody>
                {series.map((point) => (
                  <Tr key={point.on}>
                    <Td>{formatDate(point.on, "long", ctx.locale)}</Td>
                    <Td align="right">{money(point.valueCents)}</Td>
                    <Td align="right">{money(point.paidCents)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </details>
        )}
      </Card>
    );

  // ——— Year by year, under All (§6, a-04) —————————————————————————————————————————————————————
  const years = period.kind === "all" ? yearRows(funds, todayOn, firstOn) : [];
  const yearGain = (cents: Cents | null) =>
    cents === null ? <span className="text-muted">{th("years.undetermined")}</span> : money(cents, true);
  const yearsCard =
    years.length > 0 ? (
      <Card padded={false} className="min-w-0">
        <CardHeader title={th("years.title")} />
        <p className="-mt-2 px-4 pb-2 text-sm text-muted">{th("years.note")}</p>
        <div className="overflow-x-auto @max-3xl:hidden">
          <Table>
            <THead>
              <Th>{th("years.year")}</Th>
              <Th align="right">{th("years.paidIn")}</Th>
              <Th align="right">{th("years.market")}</Th>
              <Th align="right">{th("years.fees")}</Th>
              <Th align="right">{th("years.gain")}</Th>
              <Th align="right">{th("years.rate")}</Th>
              <Th align="right">{th("years.value")}</Th>
            </THead>
            <TBody>
              {years.map(({ year, summary: row }) => (
                <Tr
                  key={year}
                  data-testid="year-row"
                  data-year={year}
                  data-cents={row.gainCents === null ? "" : String(row.gainCents)}
                >
                  <Td>
                    <Link
                      href={yearHref(year)}
                      aria-label={th("years.open", { year })}
                      className="focus-ring inline-flex min-h-6 items-center rounded-[4px] font-medium hover:underline"
                    >
                      {year}
                    </Link>
                    {year === thisYear && <span className="ml-2 text-xs text-muted">{th("years.ytd")}</span>}
                  </Td>
                  <Td align="right">{money(row.paidInCents)}</Td>
                  <Td align="right" className={TONE_TEXT[toneOfSign(row.marketCents)]}>
                    {money(row.marketCents, true)}
                  </Td>
                  {/* A year with no measure has no fees here: they wait for the next value, as its gain does. */}
                  <Td align="right">
                    {row.gainCents === null ? NULL_DISPLAY : money(-row.feesCents, row.feesCents !== 0n)}
                  </Td>
                  <Td align="right" className={cn("font-semibold", TONE_TEXT[toneOfSign(row.gainCents)])}>
                    {yearGain(row.gainCents)}
                  </Td>
                  <Td align="right" className={TONE_TEXT[toneOfSign(row.rate)]}>
                    {percent(row.rate)}
                  </Td>
                  <Td align="right">{money(row.valueCents)}</Td>
                </Tr>
              ))}
              <TotalRow label={th("years.total")}>
                <Td align="right">{money(summary.paidInCents)}</Td>
                <Td align="right" className={TONE_TEXT[toneOfSign(summary.marketCents)]}>
                  {money(summary.marketCents, true)}
                </Td>
                <Td align="right">{money(-summary.feesCents, summary.feesCents !== 0n)}</Td>
                <Td align="right" className={TONE_TEXT[toneOfSign(heroCents)]}>
                  {money(heroCents, true)}
                </Td>
                <Td />
                <Td align="right">{money(summary.valueCents)}</Td>
              </TotalRow>
            </TBody>
          </Table>
        </div>
        <ul className="flex flex-col @3xl:hidden">
          {years.map(({ year, summary: row }) => (
            <li
              key={year}
              data-testid="year-item"
              className="flex items-start justify-between gap-3 border-t border-border px-4 py-2.5"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <Link
                  href={yearHref(year)}
                  aria-label={th("years.open", { year })}
                  className="focus-ring inline-flex min-h-6 items-center rounded-[4px] font-medium hover:underline"
                >
                  {year}
                </Link>
                <span className="text-xs text-muted tabular-nums">
                  {th("years.paidIn")} {money(row.paidInCents)}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-0.5 text-right tabular-nums">
                <span className={cn("font-semibold", TONE_TEXT[toneOfSign(row.gainCents)])}>
                  {yearGain(row.gainCents)}
                </span>
                <span className="text-xs text-muted">{money(row.valueCents)}</span>
              </span>
            </li>
          ))}
          <li className="flex justify-between gap-3 border-t border-border bg-bg px-4 py-2.5 font-semibold">
            <span>{th("years.total")}</span>
            <span className={cn("tabular-nums", TONE_TEXT[toneOfSign(heroCents)])}>
              {money(heroCents, true)}
            </span>
          </li>
        </ul>
      </Card>
    ) : null;

  // ——— The funds, as Investments has them (§6, a-01) ——————————————————————————————————————————
  const labels = {
    found: (date: string) => t("month.found", { date }),
    awaited: t("month.awaited"),
    missing: t("month.missing"),
    none: t("month.none"),
  };
  const subline = (line: FundLine) => {
    const row = rowOf.get(line.fund.id)!;
    if (row.fund.type === "pension") {
      return row.onTheWayCents === 0n
        ? null
        : th("list.onTheWay", { amount: money(row.onTheWayCents), count: row.onTheWayQuarters });
    }
    if (row.fund.monthlyCents === null) return th("list.noPlan");
    const pill = monthPill(row.month, ctx.locale, labels);
    return row.month.kind === "none"
      ? th("list.planOff", { amount: money(row.fund.monthlyCents) })
      : th("list.plan", { amount: money(row.fund.monthlyCents), status: pill.text });
  };
  const nameCell = (line: FundLine) => (
    <span className="flex min-w-0 items-center gap-1">
      <SeriesToggle
        seriesKey={line.fund.id}
        color={colorOf(line.fund.id)}
        label={th("list.highlight", { name: line.fund.name })}
      />
      <Link
        href={`/funds/${line.fund.id}` as Route}
        className="focus-ring inline-flex min-h-6 min-w-0 items-center rounded-[4px] font-medium hover:underline"
      >
        <span className="truncate">{line.fund.name}</span>
      </Link>
      {line.fund.archived && <Badge tone="neutral">{th("list.archived")}</Badge>}
    </span>
  );
  const gainCell = (line: FundLine) =>
    line.status === "measured" ? (
      <span
        data-testid="fund-gain"
        data-cents={String(line.measure.gainCents)}
        className={cn("font-semibold", TONE_TEXT[toneOfSign(line.measure.gainCents)])}
      >
        {money(line.measure.gainCents, true)}
      </span>
    ) : line.status === "never_valued" ? (
      <span className="text-muted">{NULL_DISPLAY}</span>
    ) : (
      <span className="text-muted">{th("list.undetermined")}</span>
    );
  const rateCell = (line: FundLine) => {
    const { rate, xirr } = line.measure;
    return (
      <span
        title={xirr?.status === "ok" ? th("list.xirr", { rate: percent(xirr.rate) }) : undefined}
        className={TONE_TEXT[rate === null ? "muted" : toneOfSign(rate)]}
      >
        {percent(rate)}
      </span>
    );
  };
  const valueText = (line: FundLine) => money(lineValue(line, period, todayOn));
  const actionCell = (line: FundLine) =>
    line.fund.archived ? null : (
      <ValuationButton
        fundId={line.fund.id}
        fundName={line.fund.name}
        today={todayOn}
        lastLine={null}
        label={line.status === "never_valued" ? th("list.first") : t("table.valuation")}
        place="row"
      />
    );
  const paidHeader =
    period.kind === "year" ? th("list.paidInYear", { year: period.year! }) : th("list.paidIn");

  const fundsCard = (
    <Card padded={false} className="min-w-0">
      <CardHeader title={th("list.title")} />
      <p className="-mt-2 px-4 pb-2 text-sm text-muted">{th("list.note")}</p>
      <div className="overflow-x-auto @max-3xl:hidden">
        <Table>
          <THead>
            <Th>{th("list.fund")}</Th>
            <Th align="right">{paidHeader}</Th>
            <Th align="right">{th("list.gain")}</Th>
            <Th align="right">{th("list.rate")}</Th>
            <Th align="right">{th("list.value")}</Th>
            <Th>{th("list.updated")}</Th>
          </THead>
          <TBody>
            {lines.map((line) => (
              <Tr key={line.fund.id} data-testid="fund-home-row" data-series-row={line.fund.id}>
                <Td className="py-1">
                  <span className="flex flex-col items-start">
                    {nameCell(line)}
                    {subline(line) && <span className="pl-7 text-xs text-muted">{subline(line)}</span>}
                  </span>
                </Td>
                <Td align="right">{money(line.measure.paidInCents)}</Td>
                <Td align="right">{gainCell(line)}</Td>
                <Td align="right">{rateCell(line)}</Td>
                <Td align="right" className="font-semibold">
                  {valueText(line)}
                </Td>
                <Td className="py-1">
                  <span className="flex flex-col items-start gap-0.5">
                    <span className="text-sm text-muted">{day(line.measure.end?.on ?? null)}</span>
                    {actionCell(line)}
                  </span>
                </Td>
              </Tr>
            ))}
            <TotalRow label={th("list.total")}>
              <Td align="right">{money(summary.paidInCents)}</Td>
              <Td align="right" className={TONE_TEXT[toneOfSign(heroCents)]}>
                {money(heroCents, true)}
              </Td>
              <Td align="right">{percent(summary.rate)}</Td>
              <Td align="right">{money(summary.valueCents)}</Td>
              <Td />
            </TotalRow>
          </TBody>
        </Table>
      </div>
      <ul className="flex flex-col @3xl:hidden">
        {lines.map((line) => (
          <li
            key={line.fund.id}
            data-testid="fund-home-item"
            data-series-row={line.fund.id}
            className="flex flex-col gap-1 border-t border-border px-4 py-2.5"
          >
            <span className="flex items-start justify-between gap-3">
              <span className="flex min-w-0 flex-col gap-0.5">
                {nameCell(line)}
                <span className="pl-7 text-xs text-muted tabular-nums">
                  {valueText(line)}
                  {line.measure.end && ` · ${th("list.updatedShort", { date: day(line.measure.end.on) })}`}
                </span>
                {subline(line) && <span className="pl-7 text-xs text-muted">{subline(line)}</span>}
              </span>
              <span className="flex shrink-0 flex-col items-end gap-0.5 text-right tabular-nums">
                {gainCell(line)}
                <span className="text-xs">{rateCell(line)}</span>
              </span>
            </span>
            <span className="flex items-center justify-between gap-3 pl-7">
              <span className="text-xs text-muted tabular-nums">
                {paidHeader} {money(line.measure.paidInCents)}
              </span>
              {actionCell(line)}
            </span>
          </li>
        ))}
        <li className="flex justify-between gap-3 border-t border-border bg-bg px-4 py-2.5 font-semibold">
          <span>{th("list.total")}</span>
          <span className={cn("tabular-nums", TONE_TEXT[toneOfSign(heroCents)])}>
            {money(heroCents, true)}
            {summary.rate !== null && ` · ${percent(summary.rate)}`}
          </span>
        </li>
      </ul>
    </Card>
  );

  // ——— Who paid in (§5.3, a-01) ———————————————————————————————————————————————————————————————
  const paidTotal = summary.paidInCents;
  const originParts = [
    { key: "you", label: th("who.you"), cents: origin.youCents, color: "var(--accent)" },
    { key: "employer", label: th("who.employer"), cents: origin.employerCents, color: "var(--pos)" },
    { key: "tfr", label: th("who.tfr"), cents: origin.tfrCents, color: "var(--muted)" },
    { key: "other", label: th("who.other"), cents: origin.otherCents, color: "var(--faint)" },
  ]
    .filter((part) => part.cents > 0n)
    .map((part) => ({
      ...part,
      share: paidTotal > 0n ? Number(part.cents) / Number(paidTotal) : 0,
    }));
  const { deductible } = summary;
  const whoCard = (
    <Card data-testid="who-paid" className="flex min-w-0 flex-col gap-3">
      <h2 className="text-lg font-semibold">{th("who.title", { when })}</h2>
      {originParts.length === 0 ? (
        <p className="text-sm text-muted">{th("who.empty")}</p>
      ) : (
        <>
          <CompositionBar parts={originParts} />
          <ul className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-4 text-sm">
            {originParts.map((part) => (
              <li
                key={part.key}
                data-origin={part.key}
                data-cents={String(part.cents)}
                className="col-span-3 grid min-h-8 grid-cols-subgrid items-center border-b border-border last:border-0"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: part.color }}
                  />
                  <span className="truncate">{part.label}</span>
                </span>
                <span className="text-right tabular-nums">{money(part.cents)}</span>
                <span className="text-right text-muted tabular-nums">{percent(part.share, false)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {deductible && period.kind === "year" && (
        <div data-testid="deductible" className="flex flex-col gap-1.5 border-t border-border pt-3">
          <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
            <span className="font-medium">{th("who.deductible", { year: period.year! })}</span>
            <span className="tabular-nums">
              {th("who.deductibleOf", {
                used: money(deductible.usedCents),
                limit: money(deductible.limitCents),
              })}
            </span>
          </p>
          <ProgressBar
            value={Math.min(1, Number(deductible.usedCents) / Number(deductible.limitCents))}
            label={th("who.deductible", { year: period.year! })}
          />
          <p className="text-sm text-muted">
            {deductible.usedCents <= deductible.limitCents
              ? th("who.deductibleNote", { left: money(deductible.limitCents - deductible.usedCents) })
              : th("who.deductibleOver", { over: money(deductible.usedCents - deductible.limitCents) })}
          </p>
        </div>
      )}
    </Card>
  );

  return (
    <Page title={t("title")} actions={add(t("add"))}>
      {alerts}
      {pageHeader}

      <section aria-labelledby="funds-gain" className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="funds-gain" className="text-sm font-medium text-muted">
            {state === "partial" ? th("gainAvailable", { period: name }) : th("gainTitle", { period: name })}
          </h2>
          <p
            data-testid="funds-hero"
            data-state={state}
            data-cents={heroCents === null ? "" : String(heroCents)}
            className="flex flex-wrap items-baseline gap-x-3"
          >
            <span
              className={cn(
                "text-[2rem] leading-tight font-semibold tracking-[-0.02em] tabular-nums",
                TONE_TEXT[toneOfSign(heroCents)],
              )}
            >
              {heroText}
            </span>
            {summary.rate !== null && (
              <span
                data-testid="funds-rate"
                title={
                  summary.xirr?.status === "ok"
                    ? th("list.xirr", { rate: percent(summary.xirr.rate) })
                    : undefined
                }
                className={cn("text-lg font-semibold tabular-nums", TONE_TEXT[toneOfSign(summary.rate)])}
              >
                {percent(summary.rate)}
              </span>
            )}
          </p>
          {valueLine && <p className="text-sm text-muted">{valueLine}</p>}
          {notes.map((note) => (
            <p key={note} className="text-sm text-muted">
              {note}
            </p>
          ))}
          {recordValue && <div className="pt-1">{recordValue}</div>}
        </div>
        {staleLink}
      </section>

      {kpis}

      <HighlightScope className="flex flex-col gap-4">
        {chartCard}
        {yearsCard}
        {state !== "payslips_only" && (
          <div className="grid items-start gap-4 @6xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            {fundsCard}
            {whoCard}
          </div>
        )}
      </HighlightScope>
      {archivedList}
    </Page>
  );
}

export const dynamic = "force-dynamic";
