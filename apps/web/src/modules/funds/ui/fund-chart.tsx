"use client";

import { useTranslations } from "next-intl";
import { LinkTabs } from "@ledgerly/ui/link-controls";
import { asNumbers, axisLabels } from "@ledgerly/ui/chart-labels";
import { GAIN_COLOR, LOSS_COLOR } from "@ledgerly/design-tokens";
import { percentAxisLabels, sampled, toCents } from "@ledgerly/ui/chart-data";
import type { RouteOutput } from "@ledgerly/api-client";
import type { funds } from "@ledgerly/api-contract/funds";
import { formatDate, formatMoney, formatPercent, NULL_DISPLAY } from "@ledgerly/format/format";
import { Card } from "@ledgerly/ui/card";
import { MultiLine, StackedBars, stackLayers } from "@ledgerly/ui/chart";
import { Table, TBody, Td, Th, THead, Tr } from "@ledgerly/ui/table";
import { TONE_TEXT, toneOfSign } from "@ledgerly/ui/tone";
import type { Params } from "@ledgerly/ui/url";
import type { Say } from "./say";
import { cents } from "./wire-forms";

type Home = RouteOutput<typeof funds.getFunds>;
type GainChart = Home["gain"];
type GainGrain = GainChart["grain"];

/** A fund of the chart: the list's order, most gain first; `gain` is null for one not measured. */
interface ChartFund {
  id: string;
  name: string;
  color: string;
  gain: string | null;
}

interface ChartProps {
  say: Say;
  /** Most gain first: the list's order, the reverse of the chart's stack. */
  lines: readonly ChartFund[];
  gain: GainChart;
  values: Home["values"];
  when: string;
  total: string | null;
  /** The period's return, as the header shows it: what the Return view's bars add up to. */
  rate: number | null;
  view: "gain" | "value" | "return";
  path: string;
  /** Every parameter but the chart's view. */
  params: Params;
  gainNote: (grain: GainGrain) => string;
  /** A fund's own page: its bars are green for a gain and red for a loss, not the fund's colour. */
  bySign?: boolean;
}

/**
 * The Performance chart of the home and of a fund (docs/design/funds-ux.md §6), drawn from the `gain`
 * and `values` of `/api/v1` (rewrite plan R3): Gain, one bar per month and a running total, or Value,
 * one step per reading and the money that reading could see. So a deposit made after a reading waits
 * for the next one, and can never look like a loss. Every figure is the server's; the chart draws.
 */
export function FundChart(props: ChartProps) {
  const { say, lines, gain, values, when, total, rate, view, path, params, gainNote, bySign = false } = props;
  const th = useTranslations("funds.home");
  const money = (amount: bigint | null, signed = false) => formatMoney(amount, say.format, { signed });
  const day = (date: string | null) => formatDate(date, "dayMonth", say.locale);
  const nameOf = new Map(lines.map((line) => [line.id, line.name]));
  const colorOf = new Map(lines.map((line) => [line.id, line.color]));

  const { grain, bars } = gain;
  const stack = [...lines].reverse();
  const totals = bars.map((bar) => cents(bar.total));
  const cumulative = bars.map((bar) => cents(bar.cumulative));
  const barName = (index: number) => {
    const bar = bars[index];
    if (grain === "year") return bar.from.slice(0, 4);
    if (grain === "month") return formatDate(bar.from, "monthYear", say.locale);
    return th("chart.stretch", { from: day(bar.from), to: day(bar.to) });
  };
  const barLabels = sampled(bars.length).map((index) =>
    grain === "year"
      ? bars[index].from.slice(0, 4)
      : grain === "month"
        ? formatDate(bars[index].from, "month", say.locale)
        : day(bars[index].to),
  );
  const extremes = gain.best === null || gain.worst === null ? null : { best: gain.best, worst: gain.worst };
  const gainSummary = th("chart.summary", {
    when,
    total: total === null ? NULL_DISPLAY : money(cents(total), true),
    best: extremes ? `${barName(extremes.best)} (${money(totals[extremes.best], true)})` : NULL_DISPLAY,
    worst: extremes ? `${barName(extremes.worst)} (${money(totals[extremes.worst], true)})` : NULL_DISPLAY,
    funds: lines
      .filter((line) => line.gain !== null)
      .map((line) => `${line.name} ${money(cents(line.gain), true)}`)
      .join(", "),
  });
  const fundGain = (bar: GainChart["bars"][number], id: string) => bar.funds.find((one) => one.fundId === id);
  const layerValues = stack.map((line) =>
    asNumbers(bars.map((bar) => cents(fundGain(bar, line.id)?.gain ?? null))),
  );
  const layers = stackLayers(layerValues, bars.length);
  const series = values.map((point) => ({
    on: point.on,
    value: cents(point.value),
    paid: cents(point.paid),
  }));
  const seriesValues = series.map((point) => point.value);
  const seriesPaid = series.map((point) => point.paid);
  const lastPoint = series.at(-1);

  // ——— The bars: money for Gain, the share of the period's return for Return ————————————————————
  const returns = view === "return";
  const percent = (value: number | null) => formatPercent(value, say.format, { signed: true });
  const noShare = bars.every((bar) => bar.share === null);
  const barLayers = stack.map((line) =>
    bars.map((bar) => {
      const one = fundGain(bar, line.id);
      if (one === undefined) return null;
      return returns ? one.share : Number(cents(one.gain));
    }),
  );
  const barStack = stackLayers(barLayers, bars.length);
  const barLine = returns ? bars.map((bar) => bar.cumulativeShare) : asNumbers(cumulative);
  const shownBar = (index: number) => (returns ? percent(bars[index].share) : money(totals[index], true));
  const shownCumulative = (index: number) =>
    returns ? percent(bars[index].cumulativeShare) : money(cumulative[index], true);
  const shownStretch = (stretch: { gain: string }, share: number | null) =>
    returns ? percent(share) : money(cents(stretch.gain), true);
  const barsBody =
    totals.every((amount) => amount === null) || (returns && noShare) ? (
      <p data-testid="chart-empty" className="text-sm text-muted">
        {returns && totals.some((amount) => amount !== null)
          ? th("chart.returnEmpty")
          : th("chart.empty", { when })}
      </p>
    ) : (
      <StackedBars
        layers={
          bySign
            ? stack.flatMap((line, index) => [
                {
                  key: line.id,
                  label: line.name,
                  color: GAIN_COLOR,
                  values: barLayers[index].map((value) => (value !== null && value >= 0 ? value : null)),
                },
                {
                  key: `${line.id}-loss`,
                  label: line.name,
                  color: LOSS_COLOR,
                  values: barLayers[index].map((value) => (value !== null && value < 0 ? value : null)),
                },
              ])
            : stack.map((line, index) => ({
                key: line.id,
                label: line.name,
                color: line.color,
                values: barLayers[index],
              }))
        }
        line={barLine}
        yLabels={
          returns
            ? percentAxisLabels([...barLine, ...barStack.top, ...barStack.bottom], say.format)
            : axisLabels(
                [...cumulative, ...layers.top.map(toCents), ...layers.bottom.map(toCents)],
                say.format,
                4,
              )
        }
        xLabels={barLabels}
        hover={bars.map((bar, index) => ({
          label: barName(index),
          value: shownBar(index),
          note: th("chart.cumulative", { amount: shownCumulative(index) }),
          rows: bar.stretches.map((stretch) => ({
            label: `${nameOf.get(stretch.fundId) ?? ""} · ${th("chart.stretch", {
              from: day(stretch.from),
              to: day(stretch.to),
            })}`,
            value: shownStretch(stretch, fundGain(bar, stretch.fundId)?.share ?? null),
            color: bySign
              ? (cents(stretch.gain) ?? 0n) < 0n
                ? LOSS_COLOR
                : GAIN_COLOR
              : (colorOf.get(stretch.fundId) ?? GAIN_COLOR),
          })),
        }))}
        summary={
          returns
            ? th("chart.returnSummary", {
                when,
                total: percent(rate),
                best: extremes ? `${barName(extremes.best)} (${shownBar(extremes.best)})` : NULL_DISPLAY,
                worst: extremes ? `${barName(extremes.worst)} (${shownBar(extremes.worst)})` : NULL_DISPLAY,
              })
            : gainSummary
        }
      />
    );

  const chartBody =
    view !== "value" ? (
      barsBody
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
        yLabels={axisLabels([...seriesValues, ...seriesPaid], say.format, 4)}
        xLabels={sampled(series.length).map((index) =>
          series[0].on.slice(0, 4) === lastPoint?.on.slice(0, 4)
            ? day(series[index].on)
            : formatDate(series[index].on, "long", say.locale),
        )}
        hover={series.map((point) => ({
          label: formatDate(point.on, "long", say.locale),
          value: money(point.value),
          note: th("chart.paidRow", { amount: money(point.paid) }),
          rows: [
            {
              label: th("chart.gain"),
              value: money((point.value ?? 0n) - (point.paid ?? 0n), true),
              color: "var(--pos)",
            },
          ],
        }))}
        summary={th("chart.valueSummary", {
          when,
          value: money(lastPoint?.value ?? null),
          date: formatDate(lastPoint?.on ?? null, "long", say.locale),
          paid: money(lastPoint?.paid ?? null),
        })}
        height={200}
      />
    );

  return (
    <Card className="flex min-w-0 flex-col gap-3" data-testid="fund-performance">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-lg font-semibold">{th("chart.title")}</h2>
          <p className="text-sm text-muted">
            {view === "gain"
              ? gainNote(grain)
              : view === "return"
                ? th("chart.returnNote")
                : th("chart.valueNote")}
          </p>
        </div>
        <LinkTabs
          label={th("chart.view")}
          path={path}
          params={params}
          name="view"
          current={view}
          options={[
            { value: "gain", label: th("chart.gain") },
            { value: "return", label: th("chart.return") },
            { value: "value", label: th("chart.value") },
          ]}
        />
      </div>
      {chartBody}
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
        {view !== "value" ? (
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
              <span aria-hidden className="size-2.5 rounded-xs bg-pos-bg" /> {th("chart.band")}
            </span>
          </>
        )}
      </p>
      {view !== "value" && totals.some((amount) => amount !== null) && (view === "gain" || !noShare) && (
        <details className="text-sm">
          <summary className="focus-ring inline-flex min-h-6 cursor-pointer items-center rounded-sm text-muted hover:text-fg">
            {th("chart.data")}
          </summary>
          <Table className="mt-2">
            <THead>
              <Th>{th("chart.interval")}</Th>
              <Th align="right">{view === "return" ? th("chart.return") : th("chart.gain")}</Th>
              <Th align="right">{th("chart.cumulativeHeader")}</Th>
            </THead>
            <TBody>
              {bars.map((bar, index) => (
                <Tr key={bar.from + bar.to}>
                  <Td>{barName(index)}</Td>
                  <Td align="right" className={TONE_TEXT[toneOfSign(totals[index])]}>
                    {shownBar(index)}
                  </Td>
                  <Td align="right">{shownCumulative(index)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </details>
      )}
      {view === "value" && series.length >= 2 && (
        <details className="text-sm">
          <summary className="focus-ring inline-flex min-h-6 cursor-pointer items-center rounded-sm text-muted hover:text-fg">
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
                  <Td>{formatDate(point.on, "long", say.locale)}</Td>
                  <Td align="right">{money(point.value)}</Td>
                  <Td align="right">{money(point.paid)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </details>
      )}
    </Card>
  );
}
