"use client";

import { TimeSeriesChart } from "@/components/chart/TimeSeriesChart";
import type { Series } from "@/lib/contracts";
import { formatCurrency } from "./CurrencyValue";

export function FundValueChart({
  series,
  label,
  currency,
}: {
  series: readonly Series[];
  label: string;
  currency: string;
}) {
  return (
    <TimeSeriesChart
      series={series}
      label={label}
      height={320}
      area={false}
      formatValue={(value) => formatCurrency(value, currency)}
    />
  );
}
