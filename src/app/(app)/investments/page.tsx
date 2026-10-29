import type { Metadata, Route } from "next";
import Link from "next/link";
import { permanentRedirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { LinkTabs } from "@/modules/accounts/ui/controls";
import { asNumbers, axisLabels, colorFor, dayLabels, PALETTE } from "@/modules/accounts/ui/display";
import { legacyPeriodQuery, periodQuery, type Query } from "@/modules/investments/period";
import type { PnlParts, ServicePnl } from "@/modules/investments/pnl";
import { investmentsHome, investmentsPnlView } from "@/modules/investments/queries";
import { PeriodControl, periodText } from "@/modules/investments/ui/period-control";
import { requireSession } from "@/platform/auth/session";
import { today } from "@/platform/dates";
import { formatDate, formatMoney, formatPercent, NULL_DISPLAY } from "@/platform/format";
import { type Cents, sumCents } from "@/platform/money";
import { Badge } from "@/ui/badge";
import { ButtonLink } from "@/ui/button";
import { Card, CardHeader } from "@/ui/card";
import { CompositionBar, StackedArea, StackedBars, stackLayers } from "@/ui/chart";
import { cn } from "@/ui/cn";
import { HighlightScope, SeriesToggle } from "@/ui/highlight";
import { KpiTile } from "@/ui/kpi-tile";
import { Popover } from "@/ui/popover";
import { Page } from "@/ui/shell/page";
import { EmptyState } from "@/ui/states";
import { Table, TBody, Td, Th, THead, TotalRow, Tr } from "@/ui/table";
import { TONE_TEXT, toneOfSign } from "@/ui/tone";
import { type Params, withParams } from "@/ui/url";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("investments"))("title") };
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Investments · Profit & loss (docs/design/investments-ux.md §3.1, U2): the P&L of the period first
 * — with how far it can be trusted — then the value of today; its parts; the chart of the period by
 * service, P&L or value; the services ordered by what they added, tied to the chart; and what the
 * portfolio holds today. The period is in the address (§1.2) and drives every P&L figure here.
 */
export default async function InvestmentsPage({ searchParams }: PageProps<"/investments">) {
  const ctx = await requireSession();
  const t = await getTranslations("investments");
  const tp = await getTranslations("investments.period");
  const query = (await searchParams) as Query;
  const todayOn = today(ctx.timeZone);

  // The charts' old address (`range`, months, `grain`) goes to the new one, once (§1.2).
  const legacy = legacyPeriodQuery(query, todayOn);
  if (legacy) permanentRedirect(withParams("/investments", {}, legacy));

  const view = one(query.view) === "value" ? "value" : "pnl";
  const by = (["class", "ccy"] as const).find((key) => key === one(query.by)) ?? "service";
  const [home, pnl] = await Promise.all([
    investmentsHome(ctx),
    investmentsPnlView(ctx, { period: one(query.period), from: one(query.from), to: one(query.to) }),
  ]);
  const currency = pnl.currency;
  const money = (cents: Cents | null, signed = false, code = currency) =>
    formatMoney(cents, ctx.numberFormat, { currency: code, signed });
  const percent = (value: number | null, signed = true) => formatPercent(value, ctx.numberFormat, { signed });
  const { portfolio, period, span } = pnl;
  const name = periodText(period, span, todayOn, ctx.locale, tp);

  /** What the period's links carry: the period, the chart's view and the composition's grouping. */
  const kept: Params = { view: view === "pnl" ? undefined : view, by: by === "service" ? undefined : by };
  const periodParams = periodQuery(period, todayOn);
  const serviceHref = (id: string) => withParams(`/investments/${id}`, {}, periodParams);
  const fundsCents = sumCents(home.funds.map((fund) => fund.valueCents)).total;

  const addService = (
    <ButtonLink href={"/investments/catalog" as Route} variant="primary" size="sm">
      {t("actions.addService")}
    </ButtonLink>
  );

  if (home.services.length === 0) {
    return (
      <Page title={t("title")} actions={addService}>
        <h1 className="text-title font-semibold tracking-[-0.02em] max-md:sr-only">{t("title")}</h1>
        <EmptyState
          title={t("empty.title")}
          description={t("home.empty")}
          actions={
            <ButtonLink href={"/investments/catalog" as Route} variant="primary">
              {t("actions.addService")}
            </ButtonLink>
          }
        />
        {fundsCents !== null && home.funds.length > 0 && <FundsLine t={t} amount={money(fundsCents)} />}
      </Page>
    );
  }

  // ——— The services, in Overview's colours, ordered by what they added (§3.1, §4.8) ——————————
  const pnlOf = new Map(portfolio.services.map((service) => [service.accountId, service]));
  const contributionOf = new Map(portfolio.contributions.map((row) => [row.accountId, row]));
  const order = new Map(portfolio.contributions.map((row, index) => [row.accountId, index]));
  const rows = home.services
    .map((summary, index) => ({
      summary,
      pnl: pnlOf.get(summary.account.id) ?? null,
      contribution: contributionOf.get(summary.account.id) ?? null,
      color: colorFor(summary.account, pnl.colorIndex.get(summary.account.id) ?? index),
    }))
    .sort(
      (a, b) =>
        (order.get(a.summary.account.id) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(b.summary.account.id) ?? Number.MAX_SAFE_INTEGER),
    );
  type Row = (typeof rows)[number];
  const nameOf = new Map(rows.map((row) => [row.summary.account.id, row.summary.account.name]));
  const parts = portfolio.parts;
  const heroCents = parts?.pnlCents ?? null;

  // ——— Hero: the state of the number, and the coverage in words (§3.1, §4.6, §4.8) ——————————
  const coverage = [
    ...portfolio.partial.map((row) =>
      t("home.coverage.partial", {
        name: nameOf.get(row.accountId) ?? "",
        date: formatDate(row.from, "dayMonth", ctx.locale),
      }),
    ),
    ...portfolio.estimated
      .filter((id) => !portfolio.partial.some((row) => row.accountId === id))
      .map((id) => t("home.coverage.estimated", { name: nameOf.get(id) ?? "" })),
    ...(portfolio.excluded.length > 0
      ? [t("home.coverage.excluded", { count: portfolio.excluded.length })]
      : []),
  ];
  const statusBadge =
    portfolio.status === "undetermined" ? (
      <Badge tone="warn">{t("home.status.undetermined")}</Badge>
    ) : portfolio.status === "estimated" ? (
      <Badge tone={portfolio.estimated.length > 0 ? "neutral" : "accent"}>
        {portfolio.estimated.length > 0 ? t("home.status.estimated") : t("home.status.partial")}
      </Badge>
    ) : null;
  const valueAtEnd =
    period.to < todayOn ? sumCents(pnl.chart.map((service) => service.values.at(-1) ?? null)).total : null;

  // ——— Alerts: one link, only with something to do or an estimate (§3.1, P9) ———————————————
  const alerts = rows.flatMap((row) => {
    const { warnings } = row.summary;
    const what = [
      warnings.conflicts > 0 && t("warnings.conflict", { count: warnings.conflicts }),
      warnings.pendingZero && t("warnings.pendingZero"),
      warnings.missingPrices > 0 && t("warnings.missingPrices", { count: warnings.missingPrices }),
      warnings.openAdjustments > 0 && t("warnings.openAdjustments", { count: warnings.openAdjustments }),
      row.pnl?.status === "estimated" &&
        row.pnl.reasons.includes("estimated_history") &&
        t("home.alerts.estimated"),
    ].filter((text): text is string => typeof text === "string");
    // U3 points this to the service's Connection tab.
    return what.length === 0
      ? []
      : [{ id: row.summary.account.id, text: `${row.summary.account.name}: ${what.join(", ")}` }];
  });

  // ——— The chart (§2.2, §3.1) ————————————————————————————————————————————————————————————
  const chartRows = [...rows].reverse();
  const chartOf = new Map(pnl.chart.map((service) => [service.accountId, service]));
  const barTotals = pnl.intervals.map((_, index) => {
    const known = pnl.chart.map((service) => service.bars[index]).filter((cents) => cents !== null);
    return known.length === 0 ? null : known.reduce<Cents>((sum, cents) => sum + cents!, 0n);
  });
  const cumulative = runningTotal(barTotals);
  const intervalName = (index: number) => {
    const interval = pnl.intervals[index];
    if (pnl.barGrain === "year") return interval.from.slice(0, 4);
    if (pnl.barGrain === "month") return formatDate(interval.from, "monthYear", ctx.locale);
    return `${formatDate(interval.from, "dayMonth", ctx.locale)} – ${formatDate(interval.to, "dayMonth", ctx.locale)}`;
  };
  const barLabels = sampled(pnl.intervals.length).map((index) =>
    pnl.barGrain === "year"
      ? pnl.intervals[index].from.slice(0, 4)
      : pnl.barGrain === "month"
        ? formatDate(pnl.intervals[index].from, "monthShort", ctx.locale)
        : formatDate(pnl.intervals[index].from, "dayMonth", ctx.locale),
  );
  const valueTotals = pnl.valueDays.map(
    (_, index) => sumCents(pnl.chart.map((service) => service.values[index])).total,
  );
  const best = bestAndWorst(barTotals);
  const summary = t("home.chart.summary", {
    period: name,
    total: heroCents === null ? NULL_DISPLAY : money(heroCents, true),
    best: best ? `${intervalName(best.best)} (${money(barTotals[best.best], true)})` : NULL_DISPLAY,
    worst: best ? `${intervalName(best.worst)} (${money(barTotals[best.worst], true)})` : NULL_DISPLAY,
    services: rows
      .filter((row) => row.pnl?.display)
      .map((row) => `${row.summary.account.name} ${money(row.pnl!.display!.pnlCents, true)}`)
      .join(", "),
  });
  const estimatedChart = pnl.chart.some((service) =>
    view === "pnl" ? service.barsEstimated.some(Boolean) : service.valuesEstimated.some(Boolean),
  );
  const stack = stackLayers(
    chartRows.map((row) => asNumbers(chartOf.get(row.summary.account.id)?.bars ?? [])),
    pnl.intervals.length,
  );

  // ——— Composition today (§3.1, H6) ————————————————————————————————————————————————————————
  const byCurrency = new Map<string, Cents>();
  for (const row of rows) {
    if (row.summary.displayCents === null || row.summary.displayCents <= 0n) continue;
    const code = row.summary.account.currency;
    byCurrency.set(code, (byCurrency.get(code) ?? 0n) + row.summary.displayCents);
  }
  const positives = (entries: [string, string, Cents, string][]) => {
    const total = entries.reduce<Cents>((sum, entry) => sum + entry[2], 0n);
    return entries
      .filter((entry) => entry[2] > 0n)
      .sort((a, b) => (a[2] > b[2] ? -1 : a[2] < b[2] ? 1 : a[1] < b[1] ? -1 : 1))
      .map(([key, label, cents, color]) => ({
        key,
        label,
        cents,
        color,
        share: total > 0n ? Number(cents) / Number(total) : 0,
      }));
  };
  const composition =
    by === "class"
      ? home.byClass.map((slice, index) => ({
          key: slice.key,
          label: t(`classes.${slice.key}` as "classes.cash"),
          cents: slice.cents,
          share: slice.share,
          color: PALETTE[index % PALETTE.length],
        }))
      : by === "ccy"
        ? positives(
            [...byCurrency.entries()].map(([code, cents], index) => [
              code,
              code,
              cents,
              PALETTE[index % PALETTE.length],
            ]),
          )
        : positives(
            rows.map((row) => [
              row.summary.account.id,
              row.summary.account.name,
              row.summary.displayCents ?? 0n,
              row.color,
            ]),
          );

  // ——— Cells shared by the table and the phone list ——————————————————————————————————————
  const nameCell = (row: Row) => (
    <span className="flex min-w-0 items-center gap-1">
      <SeriesToggle
        seriesKey={row.summary.account.id}
        color={row.color}
        label={t("home.services.highlight", { name: row.summary.account.name })}
      />
      <Link
        href={serviceHref(row.summary.account.id)}
        className="focus-ring inline-flex min-h-6 min-w-0 items-center rounded-[4px] font-medium hover:underline"
      >
        <span className="truncate">{row.summary.account.name}</span>
      </Link>
      {stateBadge(row.pnl)}
    </span>
  );
  function stateBadge(service: ServicePnl | null) {
    if (service === null) return null;
    if (service.status === "undetermined") return <Badge tone="warn">{t("home.status.undetermined")}</Badge>;
    if (service.partial && service.from)
      return (
        <Badge tone="accent">
          {t("home.status.from", { date: formatDate(service.from, "dayMonth", ctx.locale) })}
        </Badge>
      );
    if (service.status === "estimated") return <Badge tone="neutral">{t("home.status.estimated")}</Badge>;
    return null;
  }
  const valueCell = (row: Row) => {
    const { summary } = row;
    if (summary.valueCents === null) return <span className="text-muted">{t("services.noValue")}</span>;
    // The counter-value once, and only when there is one: a zero is one line (H12).
    const other =
      summary.account.currency !== currency && summary.valueCents !== 0n && summary.displayCents !== null;
    return (
      <span className="inline-flex flex-col items-end">
        <span>{money(summary.valueCents, false, summary.account.currency)}</span>
        {other && <span className="text-xs text-muted">≈ {money(summary.displayCents)}</span>}
      </span>
    );
  };
  const pnlCents = (row: Row) => row.pnl?.display?.pnlCents ?? null;
  const pnlCell = (row: Row) =>
    pnlCents(row) === null ? (
      <span className="text-muted">{t("home.services.unavailable")}</span>
    ) : (
      <span
        data-testid="service-pnl"
        data-cents={String(pnlCents(row))}
        className={cn("font-semibold", TONE_TEXT[toneOfSign(pnlCents(row))])}
      >
        {money(pnlCents(row), true)}
      </span>
    );
  const returnOf = (row: Row) => row.pnl?.displayReturn ?? null;
  const returnTitle = (row: Row) => {
    const measured = returnOf(row);
    if (!measured) return undefined;
    const notes = [
      measured.dietz === null ? t("home.services.notComputable") : null,
      measured.xirr?.status === "ok" ? t("home.services.xirr", { rate: percent(measured.xirr.rate) }) : null,
      measured.largeFlows ? t("home.services.largeFlows") : null,
    ].filter(Boolean);
    return notes.length === 0 ? undefined : notes.join(" · ");
  };
  const returnCell = (row: Row) => {
    const rate = returnOf(row)?.dietz ?? null;
    return (
      <span title={returnTitle(row)} className={TONE_TEXT[rate === null ? "muted" : toneOfSign(rate)]}>
        {percent(rate)}
      </span>
    );
  };
  const contributionCell = (row: Row) => {
    const contribution = row.contribution;
    if (!contribution) return <span className="text-muted">{NULL_DISPLAY}</span>;
    const share =
      contribution.shareOfNet === null
        ? t("home.services.shareNotComputable")
        : t("home.services.share", { share: percent(contribution.shareOfNet), net: money(heroCents, true) });
    const width = Math.abs(contribution.bar) * 50;
    return (
      <span title={share} className="inline-flex items-center gap-2">
        <span aria-hidden className="relative block h-2 w-24 rounded-full bg-track">
          <span className="absolute inset-y-[-2px] left-1/2 w-px bg-border" />
          <span
            className="absolute inset-y-0 rounded-full"
            style={{
              width: `${width}%`,
              left: contribution.bar >= 0 ? "50%" : `${50 - width}%`,
              background: contribution.bar >= 0 ? "var(--pos)" : "var(--neg)",
            }}
          />
        </span>
        <span className="sr-only">{share}</span>
      </span>
    );
  };

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-title font-semibold tracking-[-0.02em] max-md:sr-only">{t("title")}</h1>
      <PeriodControl
        period={period}
        span={span}
        todayOn={todayOn}
        firstOn={pnl.firstOn}
        path="/investments"
        params={kept}
        locale={ctx.locale}
      />
    </div>
  );

  return (
    <Page title={t("title")} actions={addService}>
      {header}

      <section aria-labelledby="pnl-title" className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="pnl-title" className="flex flex-wrap items-center gap-2 text-sm font-medium text-muted">
            {portfolio.available
              ? t("home.hero.available", { period: name })
              : t("home.hero.title", { period: name })}
            {statusBadge}
          </h2>
          <p
            data-testid="pnl-hero"
            data-cents={heroCents === null ? "" : String(heroCents)}
            className="flex flex-wrap items-baseline gap-x-3"
          >
            <span
              className={cn(
                "text-[2rem] leading-tight font-semibold tracking-[-0.02em] tabular-nums",
                TONE_TEXT[toneOfSign(heroCents)],
              )}
            >
              {heroCents === null ? t("home.hero.undetermined") : money(heroCents, true)}
            </span>
            {portfolio.rate !== null && (
              <span
                className={cn("text-lg font-semibold tabular-nums", TONE_TEXT[toneOfSign(portfolio.rate)])}
              >
                {percent(portfolio.rate)}
              </span>
            )}
          </p>
          {pnl.firstOn !== null && period.to < pnl.firstOn ? (
            <p className="text-sm text-muted">
              {t("home.hero.noData", { date: formatDate(pnl.firstOn, "long", ctx.locale) })}
            </p>
          ) : (
            coverage.length > 0 && <p className="text-sm text-muted">{coverage.join(" · ")}</p>
          )}
          <p className="text-sm text-muted">
            {t.rich("home.hero.value", {
              value: money(home.totals.valueCents),
              count: rows.length,
              strong: (chunks) => <strong className="font-semibold text-fg tabular-nums">{chunks}</strong>,
            })}
            {valueAtEnd !== null && (
              <>
                {" "}
                ·{" "}
                {t("home.hero.valueAt", {
                  date: formatDate(period.to, "long", ctx.locale),
                  value: money(valueAtEnd),
                })}
              </>
            )}
            {home.funds.length > 0 && (
              <>
                {" · "}
                {t.rich("home.funds", {
                  amount: money(fundsCents),
                  link: (chunks) => (
                    <Link
                      href={"/funds" as Route}
                      className="focus-ring inline-flex min-h-6 items-center rounded-[2px] text-accent hover:underline"
                    >
                      {chunks}
                    </Link>
                  ),
                })}
              </>
            )}
          </p>
        </div>
        {alerts.length === 1 && (
          <Link
            href={serviceHref(alerts[0].id)}
            className="focus-ring inline-flex min-h-6 items-center gap-1.5 rounded-[4px] text-sm hover:underline"
          >
            <Badge tone="warn">1</Badge>
            {t("home.alerts.one", { text: alerts[0].text })}
          </Link>
        )}
        {alerts.length > 1 && (
          <Popover
            triggerLabel={t("home.alerts.label", { count: alerts.length })}
            trigger={
              <>
                <Badge tone="warn">{alerts.length}</Badge>
                {t("home.alerts.many")}
              </>
            }
          >
            <ul className="flex max-w-80 flex-col">
              {alerts.map((alert) => (
                <li key={alert.id}>
                  <Link
                    href={serviceHref(alert.id)}
                    className="focus-ring flex min-h-8 items-center rounded-[4px] px-2 text-sm hover:bg-hover"
                  >
                    {alert.text}
                  </Link>
                </li>
              ))}
            </ul>
          </Popover>
        )}
      </section>

      {parts && <PartsKpis parts={parts} transfersCents={portfolio.transfersCents} money={money} t={t} />}

      <HighlightScope className="flex flex-col gap-4">
        <Card className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex min-w-0 flex-col gap-0.5">
              <h2 className="text-lg font-semibold">{t("home.chart.title")}</h2>
              <p className="text-sm text-muted">
                {view === "pnl"
                  ? t(`home.chart.pnlNote.${pnl.barGrain}`, { period: name })
                  : t(`home.chart.valueNote.${pnl.valueGrain}`)}
              </p>
            </div>
            <LinkTabs
              label={t("home.chart.view")}
              path="/investments"
              params={{ ...periodParams, by: kept.by }}
              name="view"
              current={view}
              options={[
                { value: "pnl", label: t("home.chart.pnl") },
                { value: "value", label: t("home.chart.value") },
              ]}
            />
          </div>
          {view === "pnl" ? (
            barTotals.every((cents) => cents === null) ? (
              <p className="text-sm text-muted">{t("chart.empty")}</p>
            ) : (
              <StackedBars
                layers={chartRows.map((row) => {
                  const service = chartOf.get(row.summary.account.id);
                  return {
                    key: row.summary.account.id,
                    label: row.summary.account.name,
                    color: row.color,
                    values: asNumbers(service?.bars ?? []),
                    estimated: service?.barsEstimated,
                  };
                })}
                line={asNumbers(cumulative)}
                yLabels={axisLabels(
                  [...cumulative, ...stack.top.map(toCents), ...stack.bottom.map(toCents)],
                  ctx.numberFormat,
                  4,
                  currency,
                )}
                xLabels={barLabels}
                hover={pnl.intervals.map((_, index) => ({
                  label: intervalName(index),
                  value: money(barTotals[index], true),
                  note: t("home.chart.cumulative", { amount: money(cumulative[index], true) }),
                  rows: rows
                    .filter((row) => (chartOf.get(row.summary.account.id)?.bars[index] ?? null) !== null)
                    .map((row) => ({
                      label: row.summary.account.name,
                      value: money(chartOf.get(row.summary.account.id)!.bars[index], true),
                      color: row.color,
                    })),
                }))}
                summary={summary}
              />
            )
          ) : valueTotals.every((cents) => cents === null) ? (
            <p className="text-sm text-muted">{t("chart.empty")}</p>
          ) : (
            <StackedArea
              layers={chartRows.map((row) => ({
                key: row.summary.account.id,
                label: row.summary.account.name,
                color: row.color,
                values: asNumbers(chartOf.get(row.summary.account.id)?.values ?? []),
              }))}
              total={asNumbers(valueTotals)}
              estimated={pnl.valueDays.map((_, index) =>
                pnl.chart.some((service) => service.valuesEstimated[index]),
              )}
              yLabels={axisLabels(valueTotals, ctx.numberFormat, 4, currency)}
              xLabels={
                pnl.valueGrain === "day"
                  ? dayLabels(pnl.valueDays, ctx.locale)
                  : sampled(pnl.valueDays.length).map((index) =>
                      formatDate(pnl.valueDays[index], "monthShort", ctx.locale),
                    )
              }
              hover={pnl.valueDays.map((day, index) => ({
                label: formatDate(day, "long", ctx.locale),
                value: money(valueTotals[index]),
                rows: rows
                  .filter((row) => (chartOf.get(row.summary.account.id)?.values[index] ?? null) !== null)
                  .map((row) => ({
                    label: row.summary.account.name,
                    value: money(chartOf.get(row.summary.account.id)!.values[index]),
                    color: row.color,
                  })),
              }))}
              summary={t("home.chart.valueSummary", { value: money(valueTotals.at(-1) ?? null) })}
              height={200}
            />
          )}
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            {view === "pnl" && (
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="h-0.5 w-4 bg-fg" /> {t("home.chart.line")}
              </span>
            )}
            <span>{t("home.chart.legend")}</span>
            {estimatedChart && <span>{t("home.chart.estimated")}</span>}
          </p>
          {view === "pnl" && barTotals.some((cents) => cents !== null) && (
            <details className="text-sm">
              <summary className="focus-ring inline-flex min-h-6 cursor-pointer items-center rounded-[4px] text-muted hover:text-fg">
                {t("home.chart.data")}
              </summary>
              <Table className="mt-2">
                <THead>
                  <Th>{t("home.chart.interval")}</Th>
                  <Th align="right">{t("home.chart.pnl")}</Th>
                  <Th align="right">{t("home.chart.cumulativeHeader")}</Th>
                </THead>
                <TBody>
                  {pnl.intervals.map((interval, index) => (
                    <Tr key={interval.from}>
                      <Td>{intervalName(index)}</Td>
                      <Td align="right" className={TONE_TEXT[toneOfSign(barTotals[index])]}>
                        {money(barTotals[index], true)}
                      </Td>
                      <Td align="right">{money(cumulative[index], true)}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </details>
          )}
        </Card>

        <div className="grid items-start gap-4 @4xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Card padded={false} className="min-w-0">
            <CardHeader title={t("services.title")} />
            <p className="-mt-2 px-4 pb-2 text-sm text-muted">{t("home.services.note")}</p>
            <div className="overflow-x-auto max-md:hidden">
              <Table>
                <THead>
                  <Th>{t("services.name")}</Th>
                  <Th align="right">{t("home.services.value")}</Th>
                  <Th align="right">{t("home.services.pnl")}</Th>
                  <Th align="right">{t("home.services.return")}</Th>
                  <Th>{t("home.services.contribution")}</Th>
                  <Th align="right">{t("services.weight")}</Th>
                </THead>
                <TBody>
                  {rows.map((row) => (
                    <Tr
                      key={row.summary.account.id}
                      data-testid="service-row"
                      data-series-row={row.summary.account.id}
                    >
                      <Td className="py-1">
                        <span className="flex flex-col items-start">
                          {nameCell(row)}
                          <span className="pl-7 text-xs text-muted">
                            {t(`categories.${row.summary.investment.category}`)}
                          </span>
                        </span>
                      </Td>
                      <Td align="right" className="py-1">
                        {valueCell(row)}
                      </Td>
                      <Td align="right">{pnlCell(row)}</Td>
                      <Td align="right">{returnCell(row)}</Td>
                      <Td>{contributionCell(row)}</Td>
                      <Td align="right">{percent(row.summary.weight, false)}</Td>
                    </Tr>
                  ))}
                  {portfolio.transfersCents !== 0n && (
                    <Tr data-testid="transfers-row" data-cents={String(portfolio.transfersCents)}>
                      <Td muted>{t("home.services.transfers")}</Td>
                      <Td />
                      <Td align="right">{money(portfolio.transfersCents, true)}</Td>
                      <Td />
                      <Td />
                      <Td />
                    </Tr>
                  )}
                  <TotalRow label={t("home.services.total")}>
                    <Td align="right">{money(home.totals.valueCents)}</Td>
                    <Td align="right" className={TONE_TEXT[toneOfSign(heroCents)]}>
                      {money(heroCents, true)}
                    </Td>
                    <Td align="right">{percent(portfolio.rate)}</Td>
                    <Td />
                    <Td align="right">{percent(1, false)}</Td>
                  </TotalRow>
                </TBody>
              </Table>
            </div>
            <ul className="flex flex-col md:hidden">
              {rows.map((row) => (
                <li
                  key={row.summary.account.id}
                  data-testid="service-item"
                  data-series-row={row.summary.account.id}
                  className="flex items-start justify-between gap-3 border-t border-border px-4 py-2.5"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    {nameCell(row)}
                    <span className="pl-7 text-xs text-muted tabular-nums">
                      {row.summary.valueCents === null
                        ? t("services.noValue")
                        : [
                            money(row.summary.valueCents, false, row.summary.account.currency),
                            row.summary.account.currency !== currency &&
                            row.summary.valueCents !== 0n &&
                            row.summary.displayCents !== null
                              ? `≈ ${money(row.summary.displayCents)}`
                              : null,
                            row.summary.weight === null ? null : percent(row.summary.weight, false),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-0.5 text-right tabular-nums">
                    {pnlCell(row)}
                    <span className="text-xs">{returnCell(row)}</span>
                  </span>
                </li>
              ))}
              {portfolio.transfersCents !== 0n && (
                <li className="flex justify-between gap-3 border-t border-border px-4 py-2.5 text-sm text-muted">
                  <span>{t("home.services.transfers")}</span>
                  <span className="tabular-nums">{money(portfolio.transfersCents, true)}</span>
                </li>
              )}
              <li className="flex justify-between gap-3 border-t border-border bg-bg px-4 py-2.5 font-semibold">
                <span>{t("home.services.total")}</span>
                <span className={cn("tabular-nums", TONE_TEXT[toneOfSign(heroCents)])}>
                  {money(heroCents, true)}
                </span>
              </li>
            </ul>
          </Card>

          <Card className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">{t("home.composition.title")}</h2>
              <LinkTabs
                label={t("home.composition.by")}
                path="/investments"
                params={{ ...periodParams, view: kept.view }}
                name="by"
                current={by}
                options={[
                  { value: "service", label: t("home.composition.service") },
                  { value: "class", label: t("home.composition.class") },
                  { value: "ccy", label: t("home.composition.ccy") },
                ]}
              />
            </div>
            {composition.length === 0 ? (
              <p className="text-sm text-muted">{t("allocation.empty")}</p>
            ) : (
              <>
                <CompositionBar parts={composition} />
                <ul className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-4 text-sm">
                  {composition.map((part) => (
                    <li
                      key={part.key}
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
            <p className="text-sm text-muted">{t("home.composition.note")}</p>
          </Card>
        </div>
      </HighlightScope>
    </Page>
  );
}

const toCents = (value: number | null): Cents | null => (value === null ? null : BigInt(Math.round(value)));

/** The running total of the bars, from zero at the start of the period; a gap stays a gap. */
function runningTotal(values: readonly (Cents | null)[]): (Cents | null)[] {
  let total: Cents = 0n;
  return values.map((cents) => {
    if (cents === null) return null;
    total += cents;
    return total;
  });
}

/** At most five evenly spread indices, the first and the last always among them. */
function sampled(length: number, count = 5): number[] {
  if (length <= count) return Array.from({ length }, (_, index) => index);
  const step = (length - 1) / (count - 1);
  return Array.from({ length: count }, (_, index) => Math.round(index * step));
}

/** The best and the worst interval, for the chart's text alternative (§7, A2). */
function bestAndWorst(values: readonly (Cents | null)[]): { best: number; worst: number } | null {
  let best = -1;
  let worst = -1;
  values.forEach((value, index) => {
    if (value === null) return;
    if (best < 0 || value > values[best]!) best = index;
    if (worst < 0 || value < values[worst]!) worst = index;
  });
  return best < 0 ? null : { best, worst };
}

/**
 * The parts of the P&L (§3.1, §4.2): four tiles as Overview has them, and under them the amounts
 * that close the sum — corrections, the part with incomplete data, transfers between services —
 * when they are not zero: tiles + that line = the hero, to the cent.
 */
function PartsKpis({
  parts,
  transfersCents,
  money,
  t,
}: {
  parts: PnlParts;
  transfersCents: Cents;
  money: (cents: Cents | null, signed?: boolean) => string;
  t: Awaited<ReturnType<typeof getTranslations<"investments">>>;
}) {
  const feesAndFx = parts.feesCents + parts.fxCents;
  const closing = [
    { key: "corrections", cents: parts.correctionsCents },
    { key: "unattributed", cents: parts.unattributedCents },
    { key: "transfers", cents: transfersCents },
  ].filter((row) => row.cents !== 0n);
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-4 @4xl:grid-cols-4">
        <KpiTile
          label={t("home.kpis.realized")}
          value={money(parts.realizedCents, true)}
          valueTone={toneOfSign(parts.realizedCents)}
          note={t("home.kpis.realizedNote")}
        />
        <KpiTile
          label={t("home.kpis.unrealized")}
          value={money(parts.unrealizedChangeCents, true)}
          valueTone={toneOfSign(parts.unrealizedChangeCents)}
          note={
            parts.unrealizedChangeCents === null
              ? t("home.kpis.unrealizedUnknown")
              : t("home.kpis.unrealizedNote")
          }
        />
        <KpiTile
          label={t("home.kpis.income")}
          value={money(parts.incomeCents, true)}
          valueTone={toneOfSign(parts.incomeCents)}
          note={t("home.kpis.incomeNote")}
        />
        <KpiTile
          label={t("home.kpis.feesFx")}
          value={money(feesAndFx, true)}
          valueTone={toneOfSign(feesAndFx)}
          note={t("home.kpis.feesFxNote", {
            fees: money(parts.feesCents, true),
            fx: money(parts.fxCents, true),
          })}
        />
      </div>
      {closing.length > 0 && (
        <p data-testid="pnl-closing" className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
          {closing.map((row) => (
            <span key={row.key} data-cents={String(row.cents)}>
              {t(`home.kpis.${row.key}` as "home.kpis.corrections")}{" "}
              <strong className={cn("font-semibold tabular-nums", TONE_TEXT[toneOfSign(row.cents)])}>
                {money(row.cents, true)}
              </strong>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

function FundsLine({
  t,
  amount,
}: {
  t: Awaited<ReturnType<typeof getTranslations<"investments">>>;
  amount: string;
}) {
  return (
    <p className="text-sm text-muted">
      {t.rich("home.funds", {
        amount,
        link: (chunks) => (
          <Link
            href={"/funds" as Route}
            className="focus-ring inline-flex min-h-6 items-center rounded-[2px] text-accent hover:underline"
          >
            {chunks}
          </Link>
        ),
      })}
    </p>
  );
}
