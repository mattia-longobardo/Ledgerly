"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { views } from "@ledgerly/api-contract/accounts";
import type { RouteOutput } from "@ledgerly/api-client";
import type { Cents } from "@ledgerly/format/cents";
import { today } from "@ledgerly/format/dates";
import {
  formatDate,
  formatMoney,
  formatPercent,
  type NumberFormat,
  type UiLocale,
} from "@ledgerly/format/format";
import { Card } from "@ledgerly/ui/card";
import { StackedArea, stackLayers } from "@ledgerly/ui/chart";
import { asNumbers, axisLabels, dayLabels, monthLabels } from "@ledgerly/ui/chart-labels";
import { cn } from "@ledgerly/ui/cn";
import { useApi } from "@ledgerly/ui/data";
import { LinkTabs } from "@ledgerly/ui/link-controls";
import { Loaded } from "@ledgerly/ui/loaded";
import { periodEnd as lastDayOf, periodMonths, type PeriodQuery } from "@ledgerly/ui/period";
import { PeriodBar } from "@ledgerly/ui/period-bar";
import { TONE_TEXT, toneOfSign } from "@ledgerly/ui/tone";
import type { Params } from "@ledgerly/ui/url";
import { centsOf, changeOf, colorFor } from "./display";

type NetWorth = RouteOutput<typeof views.getNetWorth>;
type Daily = RouteOutput<typeof views.getNetWorthDaily>;

/** What the card formats with: the person's preferences, as `GET /preferences` answers them. */
export interface CardFormat {
  locale: UiLocale;
  timeZone: string;
  numberFormat: NumberFormat;
}

interface CardProps {
  format: CardFormat;
  period: PeriodQuery;
  path: string;
  carry?: Params;
  grainParam?: string;
  controls?: boolean;
}

/** One band of the chart: an account «in the net worth», in its colour. */
interface Layer {
  id: string;
  name: string;
  color: string;
  /** Its share of the net worth at the end of the window, as `GET /net-worth` answers it. */
  share: number | null;
  values: (Cents | null)[];
}

interface Plot {
  labels: string[];
  xLabels: string[];
  layers: Layer[];
  total: (Cents | null)[];
  estimated: boolean[];
  /** The window's months, for the chart's text summary. */
  months: string[];
  currency: string;
}

/** The months of the window from the first known net worth, and where they start in the answer. */
interface Span {
  from: number;
  months: string[];
}

/**
 * "Net worth over time" (spec §7.1, F2.5): the stacked chart of Overview, also on Accounts, read from
 * `GET /net-worth` by month and `GET /net-worth/daily` by day. Its window is the period of the page
 * (PERS-342), read by month or by day (`grainParam`, which a page that already uses `grain` for
 * something else renames). With `controls` the card draws the period control itself; without, the
 * page has it. `carry` is what the page's own links carry. Nothing without accounts.
 */
export function NetWorthCard(props: CardProps) {
  const window = periodMonths(props.period.range, today(props.format.timeZone));
  const read = useApi(views.getNetWorth, { query: { months: window.months, through: window.through } });
  return (
    <Loaded state={read}>
      {(chart) => {
        if (chart.accounts.length === 0) return null;
        const span = spanOf(chart);
        return props.period.grain === "day" ? (
          <DailyCard {...props} chart={chart} span={span} />
        ) : (
          <CardBody {...props} plot={monthPlot(chart, span, props.format.locale)} />
        );
      }}
    </Loaded>
  );
}

/**
 * "All" (or a range reaching back past the history) asks for more months than there are: the months
 * before the first known net worth would be an empty stretch of chart, so they are dropped.
 */
function spanOf(chart: NetWorth): Span {
  const firstKnown = chart.netWorth.findIndex((point) => point.total !== null);
  const from = firstKnown < 0 ? 0 : firstKnown;
  return { from, months: chart.months.slice(from) };
}

/**
 * The chart's bands: every account in the net worth, the largest at the end of the window at the
 * bottom of the pile, each in the colour it has everywhere else (its own, or its palette place).
 */
function layersOf(chart: NetWorth, from: number): Layer[] {
  return chart.accounts
    .map((row, index) => ({
      row,
      layer: {
        id: row.id,
        name: row.name,
        color: colorFor(row, index),
        share: row.share,
        values: row.display.held.slice(from).map(centsOf),
      },
    }))
    .filter(({ row }) => row.inNetWorth)
    .map(({ layer }) => layer)
    .sort((a, b) => {
      const difference = (b.values.at(-1) ?? 0n) - (a.values.at(-1) ?? 0n);
      return difference > 0n ? 1 : difference < 0n ? -1 : 0;
    });
}

function monthPlot(chart: NetWorth, span: Span, locale: UiLocale): Plot {
  const points = chart.netWorth.slice(span.from);
  return {
    labels: span.months.map((month) => formatDate(month, "monthYear", locale)),
    xLabels: monthLabels(span.months, locale),
    layers: layersOf(chart, span.from),
    total: points.map((point) => centsOf(point.total)),
    // Months that stand on a month end rebuilt from the movements (spec §7.1, F2.5): drawn dashed.
    estimated: points.map((point) => point.estimated),
    months: span.months,
    currency: chart.currency,
  };
}

/**
 * Day grain (F2.5): every day of the window up to today; the API keeps the last 366 of them, since a
 * day chart of "All" would be thousands of points per account for the browser to carry.
 */
function DailyCard({ chart, span, ...props }: CardProps & { chart: NetWorth; span: Span }) {
  const end = lastDayOf(props.period.range, today(props.format.timeZone));
  const first = props.period.range.from > span.months[0] ? props.period.range.from : span.months[0];
  const start = first < end ? first : end;
  const read = useApi(views.getNetWorthDaily, { query: { from: start, to: end } });
  return (
    <Loaded state={read}>
      {(daily) => (
        <CardBody
          {...props}
          plot={dayPlot(daily, layersOf(chart, span.from), span.months, props.format.locale)}
        />
      )}
    </Loaded>
  );
}

function dayPlot(daily: Daily, bands: Layer[], months: string[], locale: UiLocale): Plot {
  const byId = new Map(daily.accounts.map((account) => [account.id, account.values]));
  return {
    labels: daily.days.map((day) => formatDate(day, "long", locale)),
    xLabels: dayLabels(daily.days, locale),
    layers: bands.map((layer) => ({
      ...layer,
      values: (byId.get(layer.id) ?? daily.days.map(() => null)).map(centsOf),
    })),
    total: daily.total.map(centsOf),
    estimated: daily.estimated,
    months,
    currency: daily.currency,
  };
}

/** The lowest edge of the pile at each step, as the chart draws it: the bottom of its scale. */
function bottomOf(plot: Plot): (Cents | null)[] {
  const { bottom } = stackLayers(
    plot.layers.map(({ values }) => asNumbers(values)),
    plot.total.length,
  );
  return bottom.map((value) => (value === null ? null : BigInt(value)));
}

function CardBody({
  format,
  period,
  path,
  carry = {},
  grainParam = "grain",
  controls = true,
  plot,
}: CardProps & { plot: Plot }) {
  const text = useTranslations("overview");
  const accountsText = useTranslations("accounts");
  const currency = { currency: plot.currency };
  const end = plot.total[plot.total.length - 1] ?? null;
  const change = changeOf(end, plot.total.find((value) => value !== null) ?? null);
  /** What the grain control carries: the page's own parameters and the period. */
  const carried = { ...carry, ...period.params };
  const money = (value: Cents | null, signed = false) =>
    formatMoney(value, format.numberFormat, { signed, ...currency });
  return (
    <Card padded={false} className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-lg font-semibold">{text("chart.title")}</h2>
          {/* What the window says, not what today says: the hero above already has today. */}
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-kpi font-semibold tracking-snug tabular-nums">{money(end)}</span>
            <span className={cn("text-sm font-medium tabular-nums", TONE_TEXT[toneOfSign(change.cents)])}>
              {money(change.cents, true)}
              {change.fraction !== null &&
                ` (${formatPercent(change.fraction, format.numberFormat, { signed: true })})`}
            </span>
            <span className="text-sm text-muted">{text("chart.inPeriod")}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {controls && <PeriodBar period={period} path={path} carry={carry} locale={format.locale} />}
          <LinkTabs
            label={accountsText("detail.chart.grain")}
            path={path}
            params={carried}
            name={grainParam}
            current={period.grain}
            options={[
              { value: "month", label: accountsText("detail.chart.grains.month") },
              { value: "day", label: accountsText("detail.chart.grains.day") },
            ]}
          />
        </div>
      </div>
      <StackedArea
        layers={plot.layers.map(({ name, color, values }) => ({
          label: name,
          color,
          values: asNumbers(values),
        }))}
        total={asNumbers(plot.total)}
        estimated={plot.estimated}
        hover={plot.labels.map((label, index) => ({
          label,
          value: money(plot.total[index]),
          note: plot.estimated[index] ? accountsText("estimated.short") : undefined,
          // Top of the pile first, as the eye reads the chart.
          rows: [...plot.layers]
            .reverse()
            .filter(({ values }) => values[index] !== null)
            .map(({ name, color, values }) => ({ label: name, value: money(values[index]), color })),
        }))}
        yLabels={axisLabels([...plot.total, ...bottomOf(plot)], format.numberFormat, 4, plot.currency)}
        xLabels={plot.xLabels}
        summary={text("chart.summary", {
          from: formatDate(plot.months[0], "monthYear", format.locale),
          to: formatDate(plot.months[plot.months.length - 1], "monthYear", format.locale),
          value: money(end),
        })}
      />
      <ul aria-label={text("chart.legend")} className="grid gap-x-6 gap-y-1.5 text-sm @3xl:grid-cols-2">
        {[...plot.layers].reverse().map(({ id, name, color, share, values }) => (
          <li key={id} className="flex min-w-0 items-center gap-2">
            <span aria-hidden className="size-2.5 shrink-0 rounded-xs-plus" style={{ background: color }} />
            <Link
              href={`/accounts/${id}`}
              className="focus-ring inline-flex h-6 min-w-0 items-center truncate rounded-xs hover:underline"
            >
              {name}
            </Link>
            <span className="ml-auto shrink-0 tabular-nums">{money(values[values.length - 1] ?? null)}</span>
            <span className="w-14 shrink-0 text-right text-muted tabular-nums">
              {formatPercent(share, format.numberFormat)}
            </span>
          </li>
        ))}
      </ul>
      {plot.estimated.some(Boolean) && <p className="text-sm text-muted">{accountsText("estimated.note")}</p>}
    </Card>
  );
}
