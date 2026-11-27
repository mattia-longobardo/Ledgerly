"use client";

// The chart of the Investments home (docs/design/investments-ux.md §2.2, §3.1): the P&L of the period
// by service and bar with its running total, the same as a share of the period's return, or the value
// by day. The bars, the running total, the returns and the value's sums are fields of the API.
import { useTranslations } from "next-intl";
import { bestAndWorst, percentAxisLabels, toCents } from "@ledgerly/ui/chart-data";
import { asNumbers, axisLabels } from "@ledgerly/ui/chart-labels";
import { stackLayers } from "@ledgerly/ui/charts/stack";
import { StackedArea } from "@ledgerly/ui/charts/stacked-area";
import { StackedBars } from "@ledgerly/ui/charts/stacked-bars";
import { LinkTabs } from "@ledgerly/ui/link-controls";
import { PerformanceCard, type PerformanceData } from "@ledgerly/ui/performance-card";
import { TONE_TEXT, toneOfSign } from "@ledgerly/ui/tone";
import { formatDate, NULL_DISPLAY } from "@ledgerly/format/format";
import { barLabels, intervalName, valueLabels } from "../period-chart";
import { centsOf } from "../present";
import { type ChartLayer, chartLayers, chipKpis, type HomeContext } from "./home-view";

type Chart = HomeContext["home"]["chart"];

const cents = (amounts: readonly (string | null)[]) => amounts.map(centsOf);

/** The layers' bars, as money or, in the Return view, as shares of the period's capital. */
function useBars(context: HomeContext) {
  const { home, view } = context;
  const { chart } = home;
  const layers = chartLayers(home);
  const valuesOf = (layer: ChartLayer) =>
    view === "return" ? layer.series.returns : asNumbers(cents(layer.series.bars));
  const line = view === "return" ? chart.cumulativeReturns : asNumbers(cents(chart.cumulative));
  return { layers, valuesOf, line };
}

/** The chart in words: the period's total, its best and worst bar, what each service added. */
function useSummary(context: HomeContext, shownBar: (index: number) => string): string {
  const text = useTranslations("investments");
  const { home, view, say, money, percent, name, chip } = context;
  const kpis = chipKpis(home, chip);
  // «Stocks and crypto» says the services' P&L, as before; a chip with funds says its KPIs.
  const services = chip === "stocks_crypto";
  const drawn = new Set(home.chart.services.map((one) => one.accountId));
  const best = bestAndWorst(cents(home.chart.bars));
  const spot = (index: number) => `${intervalName(home.chart, index, say.locale)} (${shownBar(index)})`;
  const words = {
    period: name,
    best: best ? spot(best.best) : NULL_DISPLAY,
    worst: best ? spot(best.worst) : NULL_DISPLAY,
  };
  if (view === "return")
    return text("home.chart.returnSummary", {
      ...words,
      total: percent(services ? home.pnl.modifiedDietz : kpis?.rate),
    });
  return text("home.chart.summary", {
    ...words,
    total: services
      ? home.pnl.parts === null
        ? NULL_DISPLAY
        : money(home.pnl.parts.pnl, { signed: true })
      : money(kpis?.gain ?? null, { signed: true }),
    services: home.services
      .filter((service) => service.pnl?.display && drawn.has(service.accountId))
      .map((service) => `${service.name} ${money(service.pnl?.display?.pnl, { signed: true })}`)
      .join(", "),
  });
}

function BarsChart({ context }: { context: HomeContext }) {
  const text = useTranslations("investments");
  const { home, view, say, money, percent } = context;
  const { chart } = home;
  const { layers: drawn, valuesOf, line } = useBars(context);
  const returns = view === "return";
  const shownBar = (index: number) =>
    returns ? percent(chart.returns[index]) : money(chart.bars[index], { signed: true });
  const shownLine = (index: number) =>
    returns ? percent(chart.cumulativeReturns[index]) : money(chart.cumulative[index], { signed: true });
  const layers = [...drawn].reverse().map((layer) => ({
    key: layer.key,
    label: layer.label,
    color: layer.color,
    values: valuesOf(layer),
  }));
  const stack = stackLayers(
    layers.map((layer) => layer.values),
    chart.intervals.length,
  );
  const summary = useSummary(context, shownBar);
  return (
    <StackedBars
      layers={layers}
      line={line}
      yLabels={
        returns
          ? percentAxisLabels([...line, ...stack.top, ...stack.bottom], say.format)
          : axisLabels(
              [...cents(chart.cumulative), ...stack.top.map(toCents), ...stack.bottom.map(toCents)],
              say.format,
              4,
              home.currency,
            )
      }
      xLabels={barLabels(chart, say.locale)}
      hover={Array.from(chart.intervals.keys(), (index) => ({
        label: intervalName(chart, index, say.locale),
        value: shownBar(index),
        note: text("home.chart.cumulative", { amount: shownLine(index) }),
        // A fund's month with no reading is no row: never a zero.
        rows: drawn
          .filter((layer) => (layer.series.bars[index] ?? null) !== null)
          .map((layer) => ({
            label: layer.label,
            value: returns
              ? percent(valuesOf(layer)[index])
              : money(layer.series.bars[index], { signed: true }),
            color: layer.color,
          })),
      }))}
      summary={summary}
    />
  );
}

function ValueChart({ context }: { context: HomeContext }) {
  const text = useTranslations("investments");
  const { home, say, money } = context;
  const { chart } = home;
  const layers = chartLayers(home);
  return (
    <StackedArea
      layers={[...layers].reverse().map((layer) => ({
        key: layer.key,
        label: layer.label,
        color: layer.color,
        values: asNumbers(cents(layer.series.values)),
      }))}
      total={asNumbers(cents(chart.values))}
      yLabels={axisLabels(cents(chart.values), say.format, 4, home.currency)}
      xLabels={valueLabels(chart, say.locale)}
      hover={chart.valueDays.map((day, index) => ({
        label: formatDate(day, "long", say.locale),
        value: money(chart.values[index]),
        rows: layers
          .filter((layer) => (layer.series.values[index] ?? null) !== null)
          .map((layer) => ({
            label: layer.label,
            value: money(layer.series.values[index]),
            color: layer.color,
          })),
      }))}
      summary={text("home.chart.valueSummary", { value: money(chart.values.at(-1) ?? null) })}
      height={200}
    />
  );
}

/** The bars' data as a table: each bar and the running total. */
function chartData(
  context: HomeContext,
  label: (key: "data" | "interval" | "pnl" | "return" | "cumulativeHeader") => string,
): PerformanceData {
  const { home, view, say, money, percent } = context;
  const { chart } = home;
  const returns = view === "return";
  return {
    summary: label("data"),
    head: [
      { key: "interval", label: label("interval") },
      { key: "value", label: label(returns ? "return" : "pnl"), align: "right" },
      { key: "cumulative", label: label("cumulativeHeader"), align: "right" },
    ],
    rows: chart.intervals.map((interval, index) => ({
      key: interval.from,
      cells: [
        { text: intervalName(chart, index, say.locale) },
        {
          text: returns ? percent(chart.returns[index]) : money(chart.bars[index], { signed: true }),
          align: "right",
          className: TONE_TEXT[toneOfSign(centsOf(chart.bars[index]))],
        },
        {
          text: returns
            ? percent(chart.cumulativeReturns[index])
            : money(chart.cumulative[index], { signed: true }),
          align: "right",
        },
      ],
    })),
  };
}

/** Why there is no chart: nothing in the period, or a Return view with no return to share. */
function emptyOf(chart: Chart, view: HomeContext["view"]): "empty" | "returnEmpty" | null {
  const noBars = chart.bars.every((bar) => bar === null);
  if (view === "value") return chart.values.every((value) => value === null) ? "empty" : null;
  if (noBars) return "empty";
  return view === "return" && chart.returns.every((share) => share === null) ? "returnEmpty" : null;
}

export function HomeChart({ context }: { context: HomeContext }) {
  const text = useTranslations("investments");
  const { home, view, section, name, kept } = context;
  const { chart } = home;
  const empty = emptyOf(chart, view);
  const note =
    view === "pnl"
      ? text(`home.chart.pnlNote.${chart.barGrain}`, { period: name })
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
          path="/investments"
          params={{ ...section.params, by: kept.by }}
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
        <>
          {view !== "value" && (
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-0.5 w-4 bg-fg" /> {text("home.chart.line")}
            </span>
          )}
          <span>{text("home.chart.legend")}</span>
        </>
      }
      data={
        view === "value" || empty !== null ? null : chartData(context, (key) => text(`home.chart.${key}`))
      }
    >
      {empty === "empty" && <p className="text-sm text-muted">{text("chart.empty")}</p>}
      {empty === "returnEmpty" && <p className="text-sm text-muted">{text("home.chart.returnEmpty")}</p>}
      {empty === null &&
        (view === "value" ? <ValueChart context={context} /> : <BarsChart context={context} />)}
    </PerformanceCard>
  );
}
