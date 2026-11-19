import { Plus } from "lucide-react";
import type { Metadata, Route } from "next";
import { Link } from "@ledgerly/ui/router";
import { permanentRedirect, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { colorFor } from "@/modules/accounts/ui/display";
import { PALETTE } from "@ledgerly/design-tokens";
import {
  firstDataOn,
  type FundLine,
  homeSummary,
  isFutureYear,
  lineValue,
  staleFunds,
  valueToday,
  yearRows,
} from "@ledgerly/domain/funds";
import { fundsHomeRows } from "@ledgerly/domain/funds";
import { hasPayrollCalendar } from "@ledgerly/domain/funds";
import { closesPeriodBefore, inPeriod } from "@ledgerly/domain/funds";
import { FundChart } from "@/modules/funds/ui/fund-chart";
import { FundStateButton, ValuationButton } from "@/modules/funds/ui/fund-forms";
import { Kpi } from "@/modules/funds/ui/fund-kpi";
import { monthPill, originParts, voluntaryCents } from "@/modules/funds/ui/present";
import { frequencyText } from "@/modules/funds/ui/source-text";
import {
  legacyPeriodQuery,
  periodSpan,
  SECTION_PRESETS,
  sectionPeriod,
  type Query,
  yearQuery,
} from "@ledgerly/domain/investments";
import { PeriodBar } from "@ledgerly/ui/period-bar";
import { periodText } from "@/modules/investments/ui/period-control";
import { requireSession } from "@/platform/auth/session";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { type CivilDate, today } from "@ledgerly/domain/shared/dates";
import { formatDate, formatMoney, formatPercent, NULL_DISPLAY } from "@ledgerly/domain/platform/format";
import type { Cents } from "@ledgerly/domain/shared/money";
import { Badge } from "@ledgerly/ui/badge";
import { ButtonLink } from "@ledgerly/ui/button";
import { Card, CardHeader } from "@ledgerly/ui/card";
import { CompositionBar } from "@ledgerly/ui/chart";
import { cn } from "@ledgerly/ui/cn";
import { HighlightScope, SeriesToggle } from "@ledgerly/ui/highlight";
import { Popover } from "@ledgerly/ui/popover";
import { Page } from "@ledgerly/ui/shell/page";
import { EmptyState } from "@ledgerly/ui/states";
import { Table, TBody, Td, Th, THead, TotalRow, Tr } from "@ledgerly/ui/table";
import { TONE_TEXT, toneOfSign } from "@ledgerly/ui/tone";
import { type Params, withParams } from "@ledgerly/ui/url";
import { appRoute } from "@/platform/route";
import { FundsHomeSkeleton } from "./home-skeleton";

const PATH = "/funds";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("funds"))("title") };
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Funds · the new home (docs/design/funds-ux.md §5.3, §6, F2, mockups a-01 to a-04): the gain of the
 * period first, then what explains it, the chart, the funds, and who paid in. The period is in the
 * address and drives every number here but "On the way" and the recurring debits, which stay as of today.
 *
 * The skeleton is a boundary of this page and not a `loading.tsx`: a `loading.tsx` here would also cover
 * `/funds/[id]`, and a fund that does not exist would answer 200 with a skeleton instead of a real 404.
 * The redirects stay above the boundary, so that they are real redirects.
 */
export default async function FundsHomePage({ searchParams }: PageProps<"/funds">) {
  const ctx = await requireSession();
  const query = (await searchParams) as Query;
  const todayOn = today(ctx.timeZone);

  const legacy = legacyPeriodQuery(query, todayOn);
  if (legacy) permanentRedirect(appRoute(withParams(PATH, {}, legacy)));
  const view = (["value", "return"] as const).find((key) => key === one(query.view)) ?? "gain";
  const kept: Params = { view: view === "gain" ? undefined : view };
  if (isFutureYear(one(query.period), todayOn)) redirect(appRoute(withParams(PATH, kept, {})));
  return (
    <Suspense fallback={<FundsHomeSkeleton />}>
      <FundsHome ctx={ctx} query={query} todayOn={todayOn} view={view} kept={kept} />
    </Suspense>
  );
}

async function FundsHome({
  ctx,
  query,
  todayOn,
  view,
  kept,
}: {
  ctx: Ctx;
  query: Query;
  todayOn: CivilDate;
  view: "gain" | "value" | "return";
  kept: Params;
}) {
  const t = await getTranslations("funds");
  const th = await getTranslations("funds.home");
  const tp = await getTranslations("investments.period");
  const tf = await getTranslations("funds.fund");
  const ts = await getTranslations("funds.sources");
  const rows = await fundsHomeRows(ctx);
  /** "Add fund": the form that creates a fund is a page of its own. */
  const add = (label: string, size: "sm" | "md" = "sm") => (
    <ButtonLink href="/funds/new" variant="primary" size={size}>
      <Plus aria-hidden className="size-4" />
      {label}
    </ButtonLink>
  );
  // The period in the address as it is, before the fund's list is drawn: an empty one is the year running.
  const archivedParams: Params = {
    period: one(query.period),
    from: one(query.from),
    to: one(query.to),
  };
  const archived = rows.filter((row) => row.home.archived);
  const open = rows.filter((row) => !row.home.archived);
  const archivedList =
    archived.length > 0 ? (
      <details className="text-sm">
        <summary className="focus-ring inline-flex min-h-6 cursor-pointer items-center rounded-sm text-muted">
          {t("archived.count", { count: archived.length })}
        </summary>
        <ul className="mt-2 flex flex-col gap-1">
          {archived.map(({ fund }) => (
            <li key={fund.id} className="flex items-center justify-between gap-2">
              <Link
                href={withParams(`${PATH}/${fund.id}`, {}, archivedParams)}
                className="focus-ring inline-flex min-h-6 items-center rounded-sm hover:underline"
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
        <h1 className="text-title font-semibold tracking-title max-md:sr-only">{t("title")}</h1>
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
  const period = sectionPeriod(query, todayOn).period;
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
  const periodParams = sectionPeriod(query, todayOn).params;
  const thisYear = Number(todayOn.slice(0, 4));
  const money = (cents: Cents | null, signed = false) => formatMoney(cents, ctx.numberFormat, { signed });
  const percent = (value: number | null, signed = true) => formatPercent(value, ctx.numberFormat, { signed });
  const day = (date: string | null) => formatDate(date, "dayMonth", ctx.locale);

  const rowOf = new Map(rows.map((row) => [row.fund.id, row]));
  /** A fund's page, on the period of this one: the period stays from the home to the fund (§6). */
  const fundHref = (id: string, tab?: string) => withParams(`${PATH}/${id}`, periodParams, { tab });
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
  /** Every recurring debit of an open fund that was not found by its day: always as of today. */
  const missing = open.flatMap(({ fund, detail }) =>
    detail.debits.flatMap(({ source, status }) =>
      source.state === "active" && status.kind === "missing" ? [{ fund, source, by: status.by }] : [],
    ),
  );
  const stale = staleFunds(
    open.map((row) => row.home),
    todayOn,
  );
  const onTheWayCents = open.reduce<Cents>((sum, row) => sum + row.onTheWayCents, 0n);
  // "On the way" has something to say only for a payslip source with due dates.
  const awaitsPayslips = open.some((row) => hasPayrollCalendar(row.detail));
  const firstYear = firstOn === null ? thisYear : Number(firstOn.slice(0, 4));
  const firstValueOn = funds.flatMap((fund) => fund.points.map((point) => point.on)).sort()[0] as
    string | undefined;
  const firstPaidOn = funds
    .flatMap((fund) => fund.flows.filter((flow) => flow.chargedCents > 0n).map((flow) => flow.on))
    .sort()[0] as string | undefined;
  const yearHref = (year: number) => withParams(PATH, kept, yearQuery(year, todayOn)) as Route;

  const pageHeader = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-title font-semibold tracking-title max-md:sr-only">{t("title")}</h1>
      <PeriodBar
        period={sectionPeriod(query, todayOn)}
        path={PATH}
        carry={kept}
        locale={ctx.locale}
        presets={SECTION_PRESETS}
        name={period.kind === "year" ? name : undefined}
        whole={{ range: span, text: name }}
      />
    </div>
  );

  const alerts =
    missing.length > 0 ? (
      <section className="flex flex-col gap-2">
        {missing.map(({ fund, source, by }) => (
          <div
            key={source.id}
            data-testid="fund-alert"
            className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-neg/30 bg-neg-bg px-3 py-2 text-sm"
          >
            <p>
              <strong className="font-semibold">{fund.name}</strong> —{" "}
              {t("alert.missing", {
                date: formatDate(by, "long", ctx.locale),
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
    heroCents === null && summary.valueTo !== null && closesPeriodBefore(summary.valueTo, period)
      ? th("closingNote", { date: formatDate(summary.valueTo, "long", ctx.locale) })
      : null,
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
        href={fundHref(stale[0].fund.id)}
        className="focus-ring inline-flex min-h-6 items-center gap-1.5 rounded-sm text-sm hover:underline"
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
                href={fundHref(fund.id)}
                className="focus-ring flex min-h-8 items-center rounded-sm px-2 text-sm hover:bg-hover"
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
        label={tf("recordValue")}
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
  // The voluntary payments of the period, in the funds the summary counts: the part of "you" that
  // did not come from a payslip.
  const voluntary = summary.lines.reduce<Cents>(
    (sum, line) =>
      sum +
      voluntaryCents(
        rowOf
          .get(line.fund.id)!
          .detail.operations.filter((operation) => inPeriod(operation.operationDate, period)),
      ),
    0n,
  );
  const parts = originParts(origin, voluntary);
  const paidNote =
    summary.paidInCents === 0n
      ? firstPaidOn && firstPaidOn > period.to
        ? th("kpis.paidInFirst", { date: formatDate(firstPaidOn, "long", ctx.locale) })
        : th("kpis.nothingPaid")
      : parts.map((part) => th(`kpis.originParts.${part.key}`, { amount: money(part.cents) })).join(" · ");
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
        state === "payslips_only" || awaitsPayslips ? "@4xl:grid-cols-4" : "@4xl:grid-cols-3",
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
        awaitsPayslips && (
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
            <ButtonLink href={fundHref(contributionsFund.id, "contributions")} variant="ghost" size="sm">
              {period.kind === "year" ? th("openContributions", { year: period.year! }) : th("chart.data")}
            </ButtonLink>
          )}
        </div>
      </Card>
    ) : (
      <FundChart
        ctx={ctx}
        lines={lines}
        colorOf={colorOf}
        period={period}
        span={span}
        when={when}
        totalCents={heroCents}
        rate={summary.rate}
        view={view}
        path={PATH}
        params={periodParams}
        gainNote={(grain) => th(`chart.gainNote.${grain}`, { when })}
      />
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
                      className="focus-ring inline-flex min-h-6 items-center rounded-sm font-medium hover:underline"
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
                  className="focus-ring inline-flex min-h-6 items-center rounded-sm font-medium hover:underline"
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
  /** What the fund's sources say as of today: what is on its way, and its recurring debit. None with no source. */
  const subline = (line: FundLine) => {
    const row = rowOf.get(line.fund.id)!;
    const debit = row.detail.debits.find(({ source }) => source.state === "active");
    const lines: string[] = [];
    if (hasPayrollCalendar(row.detail) && row.onTheWayCents !== 0n) {
      lines.push(th("list.onTheWay", { amount: money(row.onTheWayCents), count: row.onTheWayQuarters }));
    }
    if (debit) {
      const values = {
        amount: money(debit.source.amountCents),
        frequency: frequencyText(ts, debit.plan.frequency.count, debit.plan.frequency.unit),
      };
      lines.push(
        debit.status.kind === "none"
          ? th("list.debit", values)
          : th("list.debitStatus", {
              ...values,
              status: monthPill(debit.status, ctx.locale, labels).text,
            }),
      );
    }
    return lines.length === 0 ? null : lines.join(" · ");
  };
  const nameCell = (line: FundLine) => (
    <span className="flex min-w-0 items-center gap-1">
      <SeriesToggle
        seriesKey={line.fund.id}
        color={colorOf(line.fund.id)}
        label={th("list.highlight", { name: line.fund.name })}
      />
      <Link
        href={fundHref(line.fund.id)}
        className="focus-ring inline-flex min-h-6 min-w-0 items-center rounded-sm font-medium hover:underline"
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
        data-testid="fund-rate"
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
        label={line.status === "never_valued" ? th("list.first") : tf("recordValue")}
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

  // ——— Who paid in (§5.3, a-01), in the palette of Accounts and Expenses ———————————————————————————————————————————————————————————————
  const paidTotal = summary.paidInCents;
  const ORIGIN_COLOR = {
    you: PALETTE[0],
    employer: PALETTE[1],
    tfr: PALETTE[6],
    voluntary: PALETTE[4],
    other: PALETTE[11],
  } as const;
  const whoParts = parts
    .filter((part) => part.cents > 0n)
    .map((part) => ({
      ...part,
      label: th(`who.${part.key}`),
      color: ORIGIN_COLOR[part.key],
      share: paidTotal > 0n ? Number(part.cents) / Number(paidTotal) : 0,
    }));
  const whoCard = (
    <Card data-testid="who-paid" className="flex min-w-0 flex-col gap-3">
      <h2 className="text-lg font-semibold">{th("who.title", { when })}</h2>
      {whoParts.length === 0 ? (
        <p className="text-sm text-muted">{th("who.empty")}</p>
      ) : (
        <>
          <CompositionBar parts={whoParts} />
          <ul className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-4 text-sm">
            {whoParts.map((part) => (
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
                "text-hero leading-tight font-semibold tracking-title tabular-nums",
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
