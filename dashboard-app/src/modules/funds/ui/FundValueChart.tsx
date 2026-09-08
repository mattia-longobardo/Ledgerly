"use client";

import { TimeSeriesChart } from "@/components/chart/TimeSeriesChart";
import type { Series } from "@/lib/contracts";
import { formatCurrency } from "./CurrencyValue";

export interface FundChartSeries {
  key: string;
  label: string;
  points: { month: string; value: string | null }[];
}

export function FundValueChart({
  series,
  label,
  currency,
}: {
  series: readonly FundChartSeries[];
  label: string;
  currency: string;
}) {
  const coordinates: Series[] = series.map((entry) => ({
    ...entry,
    points: entry.points.map((point) => ({ ...point, value: point.value === null ? null : Number(point.value) })),
  }));
  const exactValues = new Map(series.map((entry) => [entry.key, new Map(entry.points.map((point) => [point.month, point.value]))]));
  return (
    <TimeSeriesChart
      series={coordinates}
      label={label}
      height={320}
      area={false}
      formatValue={(value) => formatCurrency(value, currency)}
      formatPoint={(key, month) => formatCurrency(exactValues.get(key)?.get(month), currency)}
    />
  );
}
