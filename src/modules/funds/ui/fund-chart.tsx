import { getTranslations } from "next-intl/server";
import { LinkTabs } from "@/modules/accounts/ui/controls";
import { asNumbers, axisLabels, GAIN_COLOR, LOSS_COLOR } from "@/modules/accounts/ui/display";
import {
  asReturns,
  bestAndWorst,
  percentAxisLabels,
  returnScale,
  runningTotal,
  sampled,
  toCents,
} from "@/modules/investments/ui/chart-data";
import type { Ctx } from "@ledgerly/domain/platform/context";
import type { CivilDate } from "@ledgerly/domain/platform/dates";
import { formatDate, formatMoney, formatPercent, NULL_DISPLAY } from "@ledgerly/domain/platform/format";
import type { Cents } from "@ledgerly/domain/platform/money";
import { Card } from "@/ui/card";
import { MultiLine, StackedBars, stackLayers } from "@/ui/chart";
import { Table, TBody, Td, Th, THead, Tr } from "@/ui/table";
import { TONE_TEXT, toneOfSign } from "@/ui/tone";
import type { Params } from "@/ui/url";
import { type FundLine, gainBars, type GainGrain, gainGrain, valueSeries } from "@ledgerly/domain/funds";
import type { FundPeriod } from "@ledgerly/domain/funds";

/**
 * The Performance chart of the home and of a fund (docs/design/funds-ux.md §6): Gain, one bar per
 * month and a running total, or Value, one step per reading and the money that reading could see. So a
 * deposit made after a reading waits for the next one, and can never look like a loss.
 */
export async function FundChart({
  ctx,
  lines,
  colorOf,
  period,
  span,
  when,
  totalCents,
  rate,
  view,
  path,
  params,
  gainNote,
  bySign = false,
}: {
  ctx: Pick<Ctx, "numberFormat" | "locale">;
  /** Most gain first: the list's order, the reverse of the chart's stack. */
  lines: readonly FundLine[];
  colorOf: (id: string) => string;
  period: FundPeriod & { year?: number | null };
  span: { from: CivilDate; to: CivilDate };
  when: string;
  totalCents: Cents | null;
  /** The period's return, as the header shows it: what the Return view's bars add up to. */
  rate: number | null;
  view: "gain" | "value" | "return";
  path: string;
  /** Every parameter but the chart's view. */
  params: Params;
  gainNote: (grain: GainGrain) => string;
  /** A fund's own page: its bars are green for a gain and red for a loss, not the fund's colour. */
  bySign?: boolean;
}) {
  const th = await getTranslations("funds.home");
  const money = (cents: Cents | null, signed = false) => formatMoney(cents, ctx.numberFormat, { signed });
  const day = (date: string | null) => formatDate(date, "dayMonth", ctx.locale);
  const nameOf = new Map(lines.map((line) => [line.fund.id, line.fund.name]));

  const grain = gainGrain(period, span);
  const bars = gainBars(lines, span, grain);
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
    total: totalCents === null ? NULL_DISPLAY : money(totalCents, true),
    best: extremes ? `${barName(extremes.best)} (${money(totals[extremes.best], true)})` : NULL_DISPLAY,
    worst: extremes ? `${barName(extremes.worst)} (${money(totals[extremes.worst], true)})` : NULL_DISPLAY,
    funds: lines
      .filter((line) => line.status === "measured")
      .map((line) => `${line.fund.name} ${money(line.measure.gainCents, true)}`)
      .join(", "),
  });
  const layerValues = stack.map((line) => asNumbers(bars.map((bar) => bar.byFund.get(line.fund.id) ?? null)));
  const layers = stackLayers(layerValues, bars.length);
  const series = valueSeries(lines);
  const seriesValues = series.map((point) => point.valueCents);
  const seriesPaid = series.map((point) => point.paidCents);
  const lastPoint = series.at(-1);

  // ——— The bars: money for Gain, the share of the period's return for Return ————————————————————
  const scale = view === "return" ? returnScale(totalCents, rate) : null;
  const percent = (value: number | null) => formatPercent(value, ctx.numberFormat, { signed: true });
  const asBars = (cents: readonly (Cents | null)[]) =>
    view === "return" ? asReturns(cents, scale ?? 0) : asNumbers(cents);
  const shown = (cents: Cents | null) =>
    view === "return" ? percent(cents === null ? null : Number(cents) * (scale ?? 0)) : money(cents, true);
  const barLayers = stack.map((line) => asBars(bars.map((bar) => bar.byFund.get(line.fund.id) ?? null)));
  const barStack = stackLayers(barLayers, bars.length);
  const barLine = asBars(cumulative);
  const barsBody =
    totals.every((cents) => cents === null) || (view === "return" && scale === null) ? (
      <p data-testid="chart-empty" className="text-sm text-muted">
        {view === "return" && totals.some((cents) => cents !== null)
          ? th("chart.returnEmpty")
          : th("chart.empty", { when })}
      </p>
    ) : (
      <StackedBars
        layers={
          bySign
            ? stack.flatMap((line, index) => [
                {
                  key: line.fund.id,
                  label: line.fund.name,
                  color: GAIN_COLOR,
                  values: barLayers[index].map((value) => (value !== null && value >= 0 ? value : null)),
                },
                {
                  key: `${line.fund.id}-loss`,
                  label: line.fund.name,
                  color: LOSS_COLOR,
                  values: barLayers[index].map((value) => (value !== null && value < 0 ? value : null)),
                },
              ])
            : stack.map((line, index) => ({
                key: line.fund.id,
                label: line.fund.name,
                color: colorOf(line.fund.id),
                values: barLayers[index],
              }))
        }
        line={barLine}
        yLabels={
          view === "return"
            ? percentAxisLabels([...barLine, ...barStack.top, ...barStack.bottom], ctx.numberFormat)
            : axisLabels(
                [...cumulative, ...layers.top.map(toCents), ...layers.bottom.map(toCents)],
                ctx.numberFormat,
                4,
              )
        }
        xLabels={barLabels}
        hover={bars.map((bar, index) => ({
          label: barName(index),
          value: shown(totals[index]),
          note: th("chart.cumulative", { amount: shown(cumulative[index]) }),
          rows: bar.stretches.map((stretch) => ({
            label: `${nameOf.get(stretch.fundId) ?? ""} · ${th("chart.stretch", {
              from: day(stretch.from),
              to: day(stretch.to),
            })}`,
            value: shown(stretch.gainCents),
            color: bySign ? (stretch.gainCents < 0n ? LOSS_COLOR : GAIN_COLOR) : colorOf(stretch.fundId),
          })),
        }))}
        summary={
          view === "return"
            ? th("chart.returnSummary", {
                when,
                total: percent(rate),
                best: extremes ? `${barName(extremes.best)} (${shown(totals[extremes.best])})` : NULL_DISPLAY,
                worst: extremes
                  ? `${barName(extremes.worst)} (${shown(totals[extremes.worst])})`
                  : NULL_DISPLAY,
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
              <span aria-hidden className="size-2.5 rounded-[2px] bg-pos-bg" /> {th("chart.band")}
            </span>
          </>
        )}
      </p>
      {view !== "value" && totals.some((cents) => cents !== null) && (view === "gain" || scale !== null) && (
        <details className="text-sm">
          <summary className="focus-ring inline-flex min-h-6 cursor-pointer items-center rounded-[4px] text-muted hover:text-fg">
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
                    {shown(totals[index])}
                  </Td>
                  <Td align="right">{shown(cumulative[index])}</Td>
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
}
