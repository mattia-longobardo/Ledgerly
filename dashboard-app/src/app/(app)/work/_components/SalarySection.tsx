"use client";

import { useState } from "react";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { StatTile } from "@/components/ui/StatTile";
import type { MonthPoint } from "@/lib/contracts";
import { formatEur, formatMonth } from "@/lib/format";

export type WindowKey = "3" | "6" | "12";

export interface SalaryWindow {
  key: WindowKey;
  avgNet: number | null;
  avgTaxes: number | null;
  series: MonthPoint[];
}

export interface SalarySectionProps {
  windows: readonly SalaryWindow[];
}

const OPTIONS = [
  { value: "3" as const, label: "3 m", srLabel: "3 months" },
  { value: "6" as const, label: "6 m", srLabel: "6 months" },
  { value: "12" as const, label: "12 m", srLabel: "12 months" },
];

/**
 * The averages and the bars are computed on the server for all three windows;
 * this component only switches between them, so no arithmetic happens here.
 */
export function SalarySection({ windows }: SalarySectionProps) {
  const [key, setKey] = useState<WindowKey>("3");
  const active = windows.find((w) => w.key === key) ?? windows[0];
  const points = active?.series ?? [];
  const max = points.reduce((m, p) => (p.value !== null && p.value > m ? p.value : m), 0);

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-center gap-3 px-4">
        <h2 className="min-w-0 flex-1 text-caption tracking-wide text-fg-muted uppercase">
          Salary
        </h2>
        <SegmentedControl options={OPTIONS} value={key} onChange={setKey} label="Averaging window" />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 px-4">
        <StatTile
          label={`Avg net ${key} m`}
          value={formatEur(active?.avgNet ?? null)}
          sub="Tredicesima excluded"
        />
        <StatTile
          label={`Avg taxes ${key} m`}
          value={formatEur(active?.avgTaxes ?? null)}
          sub="Per ordinary month"
        />
      </div>

      <div className="mt-4 px-4">
        <h3 className="text-caption tracking-wide text-fg-muted uppercase">Net per month</h3>
        {points.every((p) => p.value === null) ? (
          <p className="mt-2 text-body-sm text-fg-muted">Not enough history yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {points.map((point) => (
              <li key={point.month} className="flex flex-col gap-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="num text-caption text-fg-muted">{formatMonth(point.month)}</span>
                  <span className="num text-body-sm text-fg">{formatEur(point.value)}</span>
                </span>
                <span aria-hidden className="block h-1.5 rounded-xs bg-border">
                  <span
                    className="block h-full rounded-xs bg-accent"
                    style={{
                      width:
                        point.value === null || max <= 0
                          ? "0%"
                          : `${Math.max((point.value / max) * 100, 2)}%`,
                    }}
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
