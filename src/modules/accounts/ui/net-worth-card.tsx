import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { accountsView } from "@/modules/accounts/queries";
import { dailyBalancesOf } from "@/modules/accounts/service";
import type { Ctx } from "@/platform/context";
import { addDays, lastDayOfMonth, monthKey, today } from "@/platform/dates";
import { formatDate, formatMoney, formatPercent } from "@/platform/format";
import type { Cents } from "@/platform/money";
import { Card } from "@/ui/card";
import { StackedArea } from "@/ui/chart";
import { cn } from "@/ui/cn";
import { TONE_TEXT, toneOfSign } from "@/ui/tone";
import type { Params } from "@/ui/url";
import { LinkTabs, RANGE_OPTIONS, type RangeKey, rangeMonths } from "./controls";
import { asNumbers, axisLabels, changeBetween, colorFor, dayLabels, monthLabels, shareOf } from "./display";
import { MonthRangePicker } from "./month-range-picker";
import { monthRange } from "./range";

type Query = Record<string, string | string[] | undefined>;

/**
 * "Net worth over time" (spec §7.1, F2.5): the stacked chart of Overview, also on Accounts. Its
 * window is a preset (`range`) or the months the picker wrote (`from`/`to`), read by month or by day
 * (`grainParam`, which a page that already uses `grain` for something else renames). `carry` is
 * what the page's own links carry, kept by every control of the card. `null` without accounts.
 */
export async function NetWorthCard({
  ctx,
  query,
  path,
  carry = {},
  grainParam = "grain",
  now = new Date(),
}: {
  ctx: Pick<Ctx, "userId" | "timeZone" | "locale" | "numberFormat">;
  query: Query;
  path: string;
  carry?: Params;
  grainParam?: string;
  now?: Date;
}) {
  const t = await getTranslations("overview");
  const ta = await getTranslations("accounts");
  const thisMonth = monthKey(today(ctx.timeZone, now));
  const custom = monthRange(query, thisMonth);
  const range: RangeKey = RANGE_OPTIONS.find((option) => option.value === query.range)?.value ?? "1y";
  const grain = query[grainParam] === "day" ? ("day" as const) : ("month" as const);
  const chart = await accountsView(
    ctx,
    custom ? { now, months: custom.months, through: custom.to } : { now, months: rangeMonths(range) },
  );
  if (chart.rows.length === 0) return null;

  // "All" (or a range reaching back past the history) asks for more months than there are: the
  // months before the first known balance would be an empty stretch of chart, so they are dropped
  // rather than drawn as a gap.
  const firstKnown = chart.netWorth.findIndex((point) => point.total !== null);
  const from = firstKnown < 0 ? 0 : firstKnown;
  const months = chart.months.slice(from);
  const series = chart.netWorth.slice(from).map((point) => point.total);
  // Months that stand on a month end rebuilt from the movements (spec §7.1, F2.5): drawn dashed.
  const estimated = chart.netWorthEstimated.slice(from);

  /**
   * The chart's bands: every account in the net worth, the largest at the end of the window at the
   * bottom of the pile, each in the colour it has everywhere else (its own, or its palette place).
   */
  const stacked = chart.rows
    .map((row, index) => ({ row, color: colorFor(row.account, index), held: row.held.slice(from) }))
    .filter(({ row }) => row.account.inNetWorth)
    .sort((a, b) => {
      const difference = (b.held.at(-1) ?? 0n) - (a.held.at(-1) ?? 0n);
      return difference > 0n ? 1 : difference < 0n ? -1 : 0;
    });

  /**
   * What the chart draws: the window's month ends, held exactly as the net worth sums them — or, at
   * day grain (F2.5), every day of the window up to today, at most the last 366 of them: a day chart
   * of "All" would be thousands of points per account for the browser to carry.
   */
  let plot: {
    labels: string[];
    xLabels: string[];
    layers: { row: (typeof stacked)[number]["row"]; color: string; values: (Cents | null)[] }[];
    total: (Cents | null)[];
    estimated: boolean[];
  };
  if (grain === "day") {
    const todayOn = today(ctx.timeZone, now);
    const lastDay = lastDayOfMonth(months[months.length - 1]);
    const end = lastDay < todayOn ? lastDay : todayOn;
    const earliest = addDays(end, -365);
    const start = months[0] > earliest ? months[0] : earliest;
    const read = await dailyBalancesOf(
      ctx,
      stacked.map(({ row }) => row.account.id),
      { from: start, to: end },
    );
    const nothing = read.days.map(() => null);
    const layers = stacked.map(({ row, color }) => ({
      row,
      color,
      values: read.series.get(row.account.id)?.values ?? nothing,
      estimated: read.series.get(row.account.id)?.estimated ?? read.days.map(() => false),
    }));
    plot = {
      labels: read.days.map((day) => formatDate(day, "long", ctx.locale)),
      xLabels: dayLabels(read.days, ctx.locale),
      layers,
      // Summed like the net worth: unknown only when every account is.
      total: read.days.map((_, index) =>
        layers.reduce<Cents | null>((sum, layer) => {
          const value = layer.values[index];
          return value === null ? sum : (sum ?? 0n) + value;
        }, null),
      ),
      estimated: read.days.map((_, index) => layers.some((layer) => layer.estimated[index])),
    };
  } else {
    plot = {
      labels: months.map((month) => formatDate(month, "monthYear", ctx.locale)),
      xLabels: monthLabels(months, ctx.locale),
      layers: stacked.map(({ row, color, held }) => ({ row, color, values: held })),
      total: series,
      // Months that stand on a month end rebuilt from the movements (spec §7.1, F2.5): dashed.
      estimated,
    };
  }
  /** What the accounts below zero add up to at each step: the bottom of the chart's scale. */
  const negatives = plot.total.map((_, index) =>
    plot.layers.reduce<Cents>((sum, { values }) => {
      const value = values[index];
      return value !== null && value < 0n ? sum + value : sum;
    }, 0n),
  );
  const periodEnd = plot.total[plot.total.length - 1] ?? null;
  const periodChange = changeBetween(periodEnd, plot.total.find((value) => value !== null) ?? null);
  /** What the chart's links carry, so switching one control keeps the others. */
  const chartGrain = grain === "day" ? "day" : undefined;
  /** What a range control carries: the page's own parameters and the chart's grain. */
  const kept = { ...carry, [grainParam]: chartGrain };
  const carried = {
    ...kept,
    range: custom ? undefined : range,
    from: custom?.from.slice(0, 7),
    to: custom?.to.slice(0, 7),
  };

  return (
    <Card padded={false} className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-lg font-semibold">{t("chart.title")}</h2>
          {/* What the window says, not what today says: the hero above already has today. */}
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-kpi font-semibold tracking-[-0.01em] tabular-nums">
              {formatMoney(periodEnd, ctx.numberFormat)}
            </span>
            <span
              className={cn("text-sm font-medium tabular-nums", TONE_TEXT[toneOfSign(periodChange.cents)])}
            >
              {formatMoney(periodChange.cents, ctx.numberFormat, { signed: true })}
              {periodChange.fraction !== null &&
                ` (${formatPercent(periodChange.fraction, ctx.numberFormat, { signed: true })})`}
            </span>
            <span className="text-sm text-muted">{t("chart.inPeriod")}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MonthRangePicker
            from={months[0]}
            to={months[months.length - 1]}
            path={path}
            params={kept}
            locale={ctx.locale}
          />
          {/* A preset link carries no `from`/`to`: picking one leaves the custom range. */}
          <LinkTabs
            label={t("chart.range")}
            path={path}
            params={kept}
            name="range"
            current={custom ? "" : range}
            options={RANGE_OPTIONS}
          />
          <LinkTabs
            label={ta("detail.chart.grain")}
            path={path}
            params={carried}
            name={grainParam}
            current={grain}
            options={[
              { value: "month", label: ta("detail.chart.grains.month") },
              { value: "day", label: ta("detail.chart.grains.day") },
            ]}
          />
        </div>
      </div>
      <StackedArea
        layers={plot.layers.map(({ row, color, values }) => ({
          label: row.account.name,
          color,
          values: asNumbers(values),
        }))}
        total={asNumbers(plot.total)}
        estimated={plot.estimated}
        hover={plot.labels.map((label, index) => ({
          label,
          value: formatMoney(plot.total[index], ctx.numberFormat),
          note: plot.estimated[index] ? ta("estimated.short") : undefined,
          // Top of the pile first, as the eye reads the chart.
          rows: [...plot.layers]
            .reverse()
            .filter(({ values }) => values[index] !== null)
            .map(({ row, color, values }) => ({
              label: row.account.name,
              value: formatMoney(values[index], ctx.numberFormat),
              color,
            })),
        }))}
        yLabels={axisLabels([...plot.total, ...negatives], ctx.numberFormat)}
        xLabels={plot.xLabels}
        summary={t("chart.summary", {
          from: formatDate(months[0], "monthYear", ctx.locale),
          to: formatDate(months[months.length - 1], "monthYear", ctx.locale),
          value: formatMoney(periodEnd, ctx.numberFormat),
        })}
      />
      <ul aria-label={t("chart.legend")} className="grid gap-x-6 gap-y-1.5 text-sm @3xl:grid-cols-2">
        {[...plot.layers].reverse().map(({ row, color, values }) => {
          const value = values[values.length - 1] ?? null;
          return (
            <li key={row.account.id} className="flex min-w-0 items-center gap-2">
              <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ background: color }} />
              <Link
                href={`/accounts/${row.account.id}`}
                className="focus-ring min-w-0 truncate rounded-[2px] hover:underline"
              >
                {row.account.name}
              </Link>
              <span className="ml-auto shrink-0 tabular-nums">{formatMoney(value, ctx.numberFormat)}</span>
              <span className="w-14 shrink-0 text-right text-muted tabular-nums">
                {formatPercent(shareOf(value, periodEnd), ctx.numberFormat)}
              </span>
            </li>
          );
        })}
      </ul>
      {plot.estimated.some(Boolean) && <p className="text-sm text-muted">{ta("estimated.note")}</p>}
    </Card>
  );
}
