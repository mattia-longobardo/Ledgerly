"use client";

// The chart of a service (§3.3): the P&L of the period by bar, green for a gain and red for a loss, with
// its running total, the band before the data and the flows' markers; the same as a share of the
// period's return; or the value by day. Every bar, total, return and marker is a field of the API.
import { useTranslations } from "next-intl";
import { GAIN_COLOR, LOSS_COLOR } from "@ledgerly/design-tokens";
import { formatDate, NULL_DISPLAY } from "@ledgerly/format/format";
import { bestAndWorst, percentAxisLabels, toCents } from "@ledgerly/ui/chart-data";
import { asNumbers, axisLabels } from "@ledgerly/ui/chart-labels";
import { StackedArea, StackedBars, stackLayers } from "@ledgerly/ui/chart";
import { LinkTabs } from "@ledgerly/ui/link-controls";
import { PerformanceCard } from "@ledgerly/ui/performance-card";
import { barLabels, intervalName, valueLabels } from "../period-chart";
import { centsOf, colorOf } from "../present";
import type { ServicePage } from "../service/service-view";

export type ServiceView = "pnl" | "return" | "value";
type Chart = ServicePage["overview"]["chart"];

const cents = (amounts: readonly (string | null)[]) => amounts.map(centsOf);

/** The bars, the band before the data and the flows, in words for the chart's text. */
function useBarsSummary(page: ServicePage, shownBar: (index: number) => string) {
  const text = useTranslations("investments");
  const { overview, say, display, name } = page;
  const { chart, pnl, service } = overview;
  const named = (index: number) => intervalName(chart, index, say.locale);
  const best = bestAndWorst(cents(chart.bars));
  const withMarker = (kinds: readonly string[]) =>
    [...chart.intervals.keys()].filter((index) => kinds.includes(chart.markers[index] ?? ""));
  const deposits = withMarker(["in", "both"]);
  const withdrawals = withMarker(["out", "both"]);
  return [
    text("home.chart.summary", {
      period: name,
      total: pnl.display === null ? NULL_DISPLAY : display(pnl.display.pnl, { signed: true }),
      best: best ? `${named(best.best)} (${shownBar(best.best)})` : NULL_DISPLAY,
      worst: best ? `${named(best.worst)} (${shownBar(best.worst)})` : NULL_DISPLAY,
      services: service.name,
    }),
    deposits.length + withdrawals.length > 0
      ? text("service.chart.summaryFlows", {
          deposits: deposits.map(named).join(", ") || NULL_DISPLAY,
          withdrawals: withdrawals.map(named).join(", ") || NULL_DISPLAY,
        })
      : null,
  ]
    .filter(Boolean)
    .join(" ");
}

/** The slots before the days measured: a band with its words, never a zero. */
function useUnavailable(page: ServicePage) {
  const text = useTranslations("investments");
  const { chart, pnl } = page.overview;
  const from = pnl.from;
  if (from === null) return undefined;
  const slots = chart.intervals.filter((one) => one.to < from).length;
  return slots > 0
    ? {
        slots,
        label: text("service.chart.unavailable", { date: formatDate(from, "dayMonth", page.say.locale) }),
      }
    : undefined;
}

function BarsChart({ page, view }: { page: ServicePage; view: ServiceView }) {
  const text = useTranslations("investments");
  const { overview, say, display, percent } = page;
  const { chart, service } = overview;
  const returns = view === "return";
  const values = returns ? chart.returns : asNumbers(cents(chart.bars));
  const line = returns ? chart.cumulativeReturns : asNumbers(cents(chart.cumulative));
  const shownBar = (index: number) =>
    returns ? percent(chart.returns[index]) : display(chart.bars[index], { signed: true });
  const shownLine = (index: number) =>
    returns ? percent(chart.cumulativeReturns[index]) : display(chart.cumulative[index], { signed: true });
  const summary = useBarsSummary(page, (index) => display(chart.bars[index], { signed: true }));
  const stack = stackLayers([values], chart.intervals.length);
  const unavailable = useUnavailable(page);
  return (
    <StackedBars
      layers={[
        {
          key: service.accountId,
          label: service.name,
          color: GAIN_COLOR,
          values: values.map((value) => (value !== null && value >= 0 ? value : null)),
        },
        {
          key: `${service.accountId}-loss`,
          label: service.name,
          color: LOSS_COLOR,
          values: values.map((value) => (value !== null && value < 0 ? value : null)),
        },
      ]}
      line={line}
      yLabels={
        returns
          ? percentAxisLabels([...line, ...stack.top, ...stack.bottom], say.format)
          : axisLabels(
              [...cents(chart.cumulative), ...stack.top.map(toCents), ...stack.bottom.map(toCents)],
              say.format,
              4,
              overview.currency,
            )
      }
      xLabels={barLabels(chart, say.locale)}
      hover={Array.from(chart.intervals.keys(), (index) => ({
        label: intervalName(chart, index, say.locale),
        value: shownBar(index),
        note: text("home.chart.cumulative", { amount: shownLine(index) }),
      }))}
      unavailable={unavailable}
      markers={chart.markers}
      summary={summary}
    />
  );
}

function ValueChart({ page }: { page: ServicePage }) {
  const text = useTranslations("investments");
  const { overview, say, display } = page;
  const { chart, service } = overview;
  const values = asNumbers(cents(chart.values));
  return (
    <StackedArea
      layers={[
        {
          key: service.accountId,
          label: service.name,
          color: colorOf(service),
          values,
        },
      ]}
      total={values}
      yLabels={axisLabels(cents(chart.values), say.format, 4, overview.currency)}
      xLabels={valueLabels(chart, say.locale)}
      hover={chart.valueDays.map((day, index) => ({
        label: formatDate(day, "long", say.locale),
        value: display(chart.values[index]),
      }))}
      summary={text("home.chart.valueSummary", { value: display(chart.values.at(-1) ?? null) })}
      height={200}
    />
  );
}

function emptyOf(chart: Chart, view: ServiceView): "empty" | "returnEmpty" | null {
  if (view === "value") return chart.values.every((value) => value === null) ? "empty" : null;
  if (chart.bars.every((bar) => bar === null)) return "empty";
  return view === "return" && chart.returns.every((share) => share === null) ? "returnEmpty" : null;
}

export function OverviewChart({ page, view }: { page: ServicePage; view: ServiceView }) {
  const text = useTranslations("investments");
  const { chart } = page.overview;
  const empty = emptyOf(chart, view);
  const note =
    view === "pnl"
      ? text(`home.chart.pnlNote.${chart.barGrain}`, { period: page.name })
      : view === "return"
        ? text("home.chart.returnNote")
        : text(`home.chart.valueNote.${chart.valueGrain}`);
  return (
    <PerformanceCard
      title={text("home.chart.title")}
      note={note}
      views={
        <LinkTabs
          label={text("home.chart.view")}
          path={`/investments/${page.id}`}
          params={{ ...page.section.params }}
          name="view"
          current={view}
          options={[
            { value: "pnl", label: text("home.chart.pnl") },
            { value: "return", label: text("home.chart.return") },
            { value: "value", label: text("home.chart.value") },
          ]}
        />
      }
      legend={
        view !== "value" && (
          <>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-0.5 w-4 bg-fg" /> {text("home.chart.line")}
            </span>
            {chart.markers.some(Boolean) && <span>{text("service.chart.markers")}</span>}
          </>
        )
      }
      data={null}
    >
      {empty === "empty" && <p className="text-sm text-muted">{text("chart.empty")}</p>}
      {empty === "returnEmpty" && <p className="text-sm text-muted">{text("home.chart.returnEmpty")}</p>}
      {empty === null &&
        (view === "value" ? <ValueChart page={page} /> : <BarsChart page={page} view={view} />)}
    </PerformanceCard>
  );
}
