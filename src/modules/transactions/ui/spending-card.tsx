import { getTranslations } from "next-intl/server";
import { LinkTabs } from "@/modules/accounts/ui/controls";
import { asNumbers, axisLabels } from "@/modules/accounts/ui/display";
import { formatMoney, formatPercent, type NumberFormat } from "@/platform/format";
import type { Cents } from "@/platform/money";
import { Card } from "@/ui/card";
import { StackedArea } from "@/ui/chart";
import type { Params } from "@/ui/url";
import type { ChartGrain } from "./filters";

/** A group of categories as the chart draws it: its name and colour, and what it spent each step. */
export interface SpendingBand {
  id: string;
  name: string;
  color: string;
  values: Cents[];
  total: Cents;
}

/**
 * Expenses' spending over time (spec §7.2, F2.5): the same stacked chart as Overview's net worth,
 * one band per group of categories in the group's colour, the biggest spender at the bottom and
 * the total as the line on top — then a legend with what each group spent and its share. Day by
 * day or month by month, as the grain says; giroconti and hidden movements are in no band.
 */
export async function SpendingCard({
  bands,
  totals,
  labels,
  xLabels,
  grain,
  path,
  params,
  numberFormat,
}: {
  /** Biggest spender first. */
  bands: readonly SpendingBand[];
  totals: readonly Cents[];
  /** One per step, as the tooltip names it. */
  labels: readonly string[];
  xLabels: readonly string[];
  grain: ChartGrain;
  path: string;
  /** Everything the page carries, for the grain links. */
  params: Params;
  numberFormat: NumberFormat;
}) {
  const t = await getTranslations("expenses.spending");
  const spent = totals.reduce((sum, value) => sum + value, 0n);

  return (
    <Card padded={false} className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-lg font-semibold">{t("title")}</h2>
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-kpi font-semibold tracking-[-0.01em] tabular-nums">
              {formatMoney(spent, numberFormat)}
            </span>
            <span className="text-sm text-muted">{t("inRange")}</span>
          </p>
        </div>
        <LinkTabs
          label={t("grain")}
          path={path}
          params={params}
          name="grain"
          current={grain}
          options={[
            { value: "month", label: t("grains.month") },
            { value: "day", label: t("grains.day") },
          ]}
        />
      </div>

      {spent === 0n ? (
        <p className="text-muted">{t("empty")}</p>
      ) : (
        <>
          <StackedArea
            layers={bands.map((band) => ({
              label: band.name,
              color: band.color,
              values: asNumbers(band.values),
            }))}
            total={asNumbers([...totals])}
            height={200}
            hover={labels.map((label, index) => ({
              label,
              value: formatMoney(totals[index], numberFormat),
              // The biggest spenders of that step first; a group that spent nothing is left out.
              rows: bands
                .filter((band) => band.values[index] !== 0n)
                .sort((a, b) => Number(b.values[index] - a.values[index]))
                .map((band) => ({
                  label: band.name,
                  value: formatMoney(band.values[index], numberFormat),
                  color: band.color,
                })),
            }))}
            yLabels={axisLabels([...totals], numberFormat)}
            xLabels={xLabels}
            summary={t("summary", { total: formatMoney(spent, numberFormat) })}
          />
          <ul
            aria-label={t("legend")}
            className="grid gap-x-6 gap-y-1.5 text-sm @3xl:grid-cols-2 @wide:grid-cols-3"
          >
            {bands.map((band) => (
              <li key={band.id} className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-[3px]"
                  style={{ background: band.color }}
                />
                <span className="min-w-0 truncate">{band.name}</span>
                <span className="ml-auto shrink-0 tabular-nums">{formatMoney(band.total, numberFormat)}</span>
                <span className="w-14 shrink-0 text-right text-muted tabular-nums">
                  {formatPercent(Number(band.total) / Number(spent), numberFormat)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
