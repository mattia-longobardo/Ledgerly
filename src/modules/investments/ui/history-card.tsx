import { getTranslations } from "next-intl/server";
import { LinkTabs, RANGE_OPTIONS } from "@/modules/accounts/ui/controls";
import { asNumbers, axisLabels, dayLabels, monthLabels } from "@/modules/accounts/ui/display";
import { MonthRangePicker } from "@/modules/accounts/ui/month-range-picker";
import { monthRange } from "@/modules/accounts/ui/range";
import { investmentHistory } from "@/modules/investments/queries";
import type { ChartWindow } from "@/modules/investments/window";
import type { Ctx } from "@/platform/context";
import { monthKey, today } from "@/platform/dates";
import { formatDate, formatMoney } from "@/platform/format";
import type { Cents } from "@/platform/money";
import { Card } from "@/ui/card";
import { MultiLine } from "@/ui/chart";

type Query = Record<string, string | string[] | undefined>;

/** The window the address asks for (PERS-100): the last year unless a preset or the picker says otherwise. */
export function chartWindowOf(query: Query, thisMonth: string): ChartWindow {
  const custom = monthRange(query, thisMonth);
  return {
    grain: query.grain === "day" ? "day" : "month",
    range: custom ? null : (RANGE_OPTIONS.find((option) => option.value === query.range)?.value ?? "1y"),
    custom: custom ? { from: custom.from, to: custom.to } : null,
  };
}

/**
 * "Value and net invested" of the home and of a service (docs/design/investments.md §4.1, §4.3),
 * with the period controls of Overview's chart (spec §7.1, F2.5, PERS-100): the last year by
 * default, 3M · 1Y · All, the month range picker, by month or by day. A stretch that stands on an
 * estimated reading is dashed and said so below the chart.
 */
export async function InvestmentHistoryCard({
  ctx,
  query,
  path,
  accountId,
  summaryValue,
  now = new Date(),
}: {
  ctx: Pick<Ctx, "userId" | "timeZone" | "locale" | "numberFormat" | "displayCurrency">;
  query: Query;
  path: string;
  accountId?: string;
  /** The value and net invested of today, as the KPIs above say them: the chart's text summary. */
  summaryValue: { value: Cents | null; invested: Cents | null };
  now?: Date;
}) {
  const t = await getTranslations("investments");
  const window = chartWindowOf(query, monthKey(today(ctx.timeZone, now)));
  const history = await investmentHistory(ctx, { window, accountId, now });
  if (!history) return null;
  const money = (cents: Cents | null) => formatMoney(cents, ctx.numberFormat, { currency: history.currency });
  const byDay = history.grain === "day";
  const kept = { grain: byDay ? "day" : undefined };
  const carried = {
    ...kept,
    range: window.custom ? undefined : (window.range ?? undefined),
    from: window.custom?.from.slice(0, 7),
    to: window.custom?.to.slice(0, 7),
  };
  const estimated = history.estimated.some(Boolean);

  return (
    <Card className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-lg font-semibold">{t("chart.title")}</h2>
          <span className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-0.5 w-4 bg-accent" /> {t("chart.value")}
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="w-4 border-t border-dashed border-muted" /> {t("chart.invested")}
            </span>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MonthRangePicker
            from={history.months[0]}
            to={history.months[history.months.length - 1]}
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
            current={window.custom ? "" : (window.range ?? "1y")}
            options={RANGE_OPTIONS}
          />
          <LinkTabs
            label={t("chart.grain")}
            path={path}
            params={carried}
            name="grain"
            current={history.grain}
            options={[
              { value: "month", label: t("chart.grains.month") },
              { value: "day", label: t("chart.grains.day") },
            ]}
          />
        </div>
      </div>
      {history.value.every((value) => value === null) ? (
        <p className="text-sm text-muted">{t("chart.empty")}</p>
      ) : (
        <MultiLine
          series={[
            { values: asNumbers(history.value), color: "var(--accent)", estimated: history.estimated },
            { values: asNumbers(history.invested), color: "var(--muted)", dashed: true, step: true },
          ]}
          yLabels={axisLabels([...history.value, ...history.invested], ctx.numberFormat, 4, history.currency)}
          xLabels={byDay ? dayLabels(history.days, ctx.locale) : monthLabels(history.months, ctx.locale)}
          hover={history.days.map((day, index) => ({
            label: byDay ? formatDate(day, "long", ctx.locale) : formatDate(day, "monthYear", ctx.locale),
            value: money(history.value[index]),
            note: [
              t("chart.hoverInvested", { amount: money(history.invested[index]) }),
              history.estimated[index] ? t("chart.estimatedShort") : null,
            ]
              .filter(Boolean)
              .join(" · "),
          }))}
          summary={t("chart.summary", {
            value: money(summaryValue.value),
            invested: money(summaryValue.invested),
          })}
          height={180}
        />
      )}
      {estimated && <p className="text-sm text-muted">{t("chart.estimatedNote")}</p>}
    </Card>
  );
}
