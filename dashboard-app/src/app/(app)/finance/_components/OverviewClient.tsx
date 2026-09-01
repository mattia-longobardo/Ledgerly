"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TimeSeriesChart } from "@/components/chart/TimeSeriesChart";
import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { AccountList, AccountRow } from "@/components/ui/AccountRow";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { MoneyValue } from "@/components/ui/MoneyValue";
import { StaleBadge } from "@/components/ui/StaleBadge";
import { RangeSelector, type MonthRange, type RangeKey } from "@/components/ui/RangeSelector";
import type { MonthPoint, Series } from "@/lib/contracts";
import { carryForward, deltaOverRange, rangeToMonths, type RangeSpec } from "@/lib/calc/series";
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

const RANGE_KEYS = Object.keys(PRESET) as RangeKey[];
const MONTH_PARAM = /^\d{4}-\d{2}$/;

interface ViewState {
  rangeKey: RangeKey;
  custom: MonthRange | null;
  selected: string | null;
}

const DEFAULT_STATE: ViewState = { rangeKey: "12M", custom: null, selected: null };

/**
 * The view lives in the URL, not in `useState` alone. A range and a selected
 * account are what this screen IS, so both have to survive a reload, be
 * linkable, and answer to the back button.
 */
function readUrl(search: string): ViewState {
  const params = new URLSearchParams(search);
  const range = params.get("range");
  const from = params.get("from");
  const to = params.get("to");
  const account = params.get("account");

  const custom =
    from !== null && to !== null && MONTH_PARAM.test(from) && MONTH_PARAM.test(to) && from <= to
      ? { from, to }
      : null;

  return {
    rangeKey: RANGE_KEYS.find((k) => k === range) ?? DEFAULT_STATE.rangeKey,
    custom,
    selected: account,
  };
}

function toSearch(state: ViewState): string {
  const params = new URLSearchParams();
  if (state.custom !== null) {
    params.set("range", "custom");
    params.set("from", state.custom.from);
    params.set("to", state.custom.to);
  } else if (state.rangeKey !== DEFAULT_STATE.rangeKey) {
    params.set("range", state.rangeKey);
  }
  if (state.selected !== null) params.set("account", state.selected);
  const query = params.toString();
  return query === "" ? window.location.pathname : `${window.location.pathname}?${query}`;
}

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
 * "select an account to filter it" interaction. Every figure it draws was
 * already read from Postgres on the server.
 *
 * State changes go through `history.pushState` rather than the router, so the
 * URL stays truthful and the back button works without refetching a server
 * component for a purely local filter.
 */
export function OverviewClient({ total, accounts, earliestMonth }: OverviewClientProps) {
  const [state, setState] = useState<ViewState>(DEFAULT_STATE);

  // Hydration-safe: the server rendered the default view, so the URL is read
  // after mount and again on every back/forward.
  useEffect(() => {
    const sync = () => setState(readUrl(window.location.search));
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const commit = useCallback((next: ViewState) => {
    setState(next);
    window.history.pushState(null, "", toSearch(next));
  }, []);

  const months = useMemo(() => {
    const spec: RangeSpec =
      state.custom === null ? PRESET[state.rangeKey] : { from: state.custom.from, to: state.custom.to };
    return rangeToMonths(spec, { earliest: earliestMonth });
  }, [state.rangeKey, state.custom, earliestMonth]);

  // Default series: the total, which is the sum of the account rows below it
  // rather than a figure read from anywhere — so selecting every account in
  // turn accounts for every euro in the default curve.
  const active =
    state.selected === null ? total : (accounts.find((a) => a.key === state.selected) ?? total);
  const series = useMemo(() => [toSeries(active, months)], [active, months]);
  const delta = deltaOverRange(active.points, 1);

  return (
    <PageGrid className="pt-5">
      <Panel span={8} ariaLabel={`${active.label} over time`}>
        {/* The primary read, promoted. It used to be a caption over a chart,
            which left the screen with no figure to land on. */}
        <div className="axis-rule-live pb-6">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="text-caption tracking-wide text-fg-muted uppercase">
              {active.label}
            </span>
            {state.selected !== null && (
              <button
                type="button"
                onClick={() => commit({ ...state, selected: null })}
                className="inline-flex min-h-11 items-center rounded-xs text-body-sm font-medium text-accent transition-colors hover:text-accent-hover"
              >
                Show total
              </button>
            )}
          </div>
          <MoneyValue value={active.balance} size="display" cents="muted" />
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            {delta.abs !== null && (
              <DeltaBadge value={delta.abs} percent={delta.pct} context="versus last month" />
            )}
            <StaleBadge capturedAt={active.capturedAt} stale={active.stale} />
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-caption tracking-wide text-fg-muted uppercase">By month</h2>
          <RangeSelector
            value={state.rangeKey}
            custom={state.custom}
            onChange={(next, range) =>
              commit({
                ...state,
                rangeKey: next === "custom" ? state.rangeKey : next,
                custom: range,
              })
            }
            minMonth={earliestMonth === null ? undefined : earliestMonth.slice(0, 7)}
          />
        </div>

        <TimeSeriesChart
          series={series}
          label={`${active.label} by month`}
          height={360}
          area
          className="mt-3"
        />
      </Panel>

      <Panel span={4} spanMd={4} title="Accounts">
        <AccountList>
          {accounts.map((account) => (
            <AccountRow
              key={account.key}
              name={account.label}
              value={account.balance}
              capturedAt={account.capturedAt}
              stale={account.stale}
              onSelect={() =>
                commit({
                  ...state,
                  selected: account.key === state.selected ? null : account.key,
                })
              }
              className={cn(account.key === state.selected && "bg-surface")}
            />
          ))}
        </AccountList>
      </Panel>
    </PageGrid>
  );
}
