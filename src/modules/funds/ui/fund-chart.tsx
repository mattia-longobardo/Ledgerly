import { getTranslations } from "next-intl/server";
import { LinkTabs } from "@/modules/accounts/ui/controls";
import { asNumbers, axisLabels } from "@/modules/accounts/ui/display";
import { bestAndWorst, runningTotal, sampled, toCents } from "@/modules/investments/ui/chart-data";
import type { Ctx } from "@/platform/context";
import type { CivilDate } from "@/platform/dates";
import { formatDate, formatMoney, NULL_DISPLAY } from "@/platform/format";
import type { Cents } from "@/platform/money";
import { Card } from "@/ui/card";
import { MultiLine, StackedBars, stackLayers } from "@/ui/chart";
import { Table, TBody, Td, Th, THead, Tr } from "@/ui/table";
import { TONE_TEXT, toneOfSign } from "@/ui/tone";
import type { Params } from "@/ui/url";
import { type FundLine, gainBars, type GainGrain, gainGrain, valueSeries } from "../home";
import type { FundPeriod } from "../period";

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
  view,
  path,
  params,
  gainNote,
}: {
  ctx: Pick<Ctx, "numberFormat" | "locale">;
  /** Most gain first: the list's order, the reverse of the chart's stack. */
  lines: readonly FundLine[];
  colorOf: (id: string) => string;
  period: FundPeriod & { year?: number | null };
  span: { from: CivilDate; to: CivilDate };
  when: string;
  totalCents: Cents | null;
  view: "gain" | "value";
  path: string;
  /** Every parameter but the chart's view. */
  params: Params;
  gainNote: (grain: GainGrain) => string;
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
              label: `${nameOf.get(stretch.fundId) ?? ""} · ${th("chart.stretch", {
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

  return (
    <Card className="flex min-w-0 flex-col gap-3" data-testid="fund-performance">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-lg font-semibold">{th("chart.title")}</h2>
          <p className="text-sm text-muted">{view === "gain" ? gainNote(grain) : th("chart.valueNote")}</p>
        </div>
        <LinkTabs
          label={th("chart.view")}
          path={path}
          params={params}
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
}
