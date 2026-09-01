"use client";

import { useMemo, useState } from "react";
import { TimeSeriesChart } from "@/components/chart/TimeSeriesChart";
import { AccountRow } from "@/components/ui/AccountRow";
import { RangeSelector, type MonthRange, type RangeKey } from "@/components/ui/RangeSelector";
import type { MonthPoint, Series } from "@/lib/contracts";
import { carryForward, rangeToMonths, type RangeSpec } from "@/lib/calc/series";
import { cn } from "@/components/ui/cn";

export interface OverviewAccount {
  key: string;
  label: string;
  balance: string | null;
  capturedAt: Date | null;
  stale: boolean;
  points: MonthPoint[];
}

export interface OverviewClientProps {
  total: OverviewAccount;
  accounts: readonly OverviewAccount[];
  earliestMonth: string | null;
}

const PRESET: Record<RangeKey, RangeSpec> = {
  "1M": "1M",
  "3M": "3M",
  "6M": "6M",
  "12M": "12M",
  YTD: "YTD",
  All: "ALL",
};

function toSeries(account: OverviewAccount, months: readonly string[]): Series {
  const byMonth = new Map(carryForward(account.points).map((p) => [p.month, p.value] as const));
  return {
    key: account.key,
    label: account.label,
    points: months.map((month) => ({ month, value: byMonth.get(month) ?? null })),
  };
}

/**
 * The only client component on the Overview: the range pills, the chart and the
 * "tap an account to filter it" interaction. Every figure it draws was already
 * read from Postgres on the server.
 */
export function OverviewClient({ total, accounts, earliestMonth }: OverviewClientProps) {
  const [rangeKey, setRangeKey] = useState<RangeKey>("12M");
  const [custom, setCustom] = useState<MonthRange | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const months = useMemo(() => {
    const spec: RangeSpec = custom === null ? PRESET[rangeKey] : { from: custom.from, to: custom.to };
    return rangeToMonths(spec, { earliest: earliestMonth });
  }, [rangeKey, custom, earliestMonth]);

  // Default series: the total, which is the sum of the account rows below it
  // rather than a figure read from anywhere — so selecting every account in
  // turn accounts for every euro in the default curve.
  const active = selected === null ? total : (accounts.find((a) => a.key === selected) ?? total);
  const series = useMemo(() => [toSeries(active, months)], [active, months]);

  return (
    <>
      <RangeSelector
        value={rangeKey}
        custom={custom}
        onChange={(next, range) => {
          if (next !== "custom") setRangeKey(next);
          setCustom(range);
        }}
        minMonth={earliestMonth === null ? undefined : earliestMonth.slice(0, 7)}
      />

      <div className="px-4 pt-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-caption tracking-wide text-fg-muted uppercase">
            {selected === null ? "Total wealth" : active.label}
          </span>
          {selected !== null && (
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="-mr-2 inline-flex min-h-11 items-center rounded-xs px-2 text-body-sm font-medium text-accent"
            >
              Show total
            </button>
          )}
        </div>
        <TimeSeriesChart
          series={series}
          label={`${active.label} by month`}
          height={200}
          area
          className="mt-2"
        />
      </div>

      <div className="mt-4 hairline-t">
        {accounts.map((account) => (
          <AccountRow
            key={account.key}
            name={account.label}
            value={account.balance}
            capturedAt={account.capturedAt}
            stale={account.stale}
            onSelect={() => setSelected(account.key === selected ? null : account.key)}
            className={cn(account.key === selected && "bg-surface")}
          />
        ))}
      </div>
    </>
  );
}
