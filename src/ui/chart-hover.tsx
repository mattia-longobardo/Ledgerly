"use client";

import { type MouseEvent, useState } from "react";

export interface HoverPoint {
  label: string;
  value: string;
  note?: string;
  /** A breakdown under the value, one line each (F2.5: the accounts of a stacked chart). */
  rows?: readonly { label: string; value: string; color: string }[];
}

/**
 * The design's crosshair: a vertical line and a tooltip that follow the pointer across a chart the
 * server has already drawn. It is an absolute overlay over the plot area, so the figure and its
 * text summary exist without JavaScript — this adds comfort, it is never the only way to the
 * numbers.
 */
export function ChartHover({ points }: { points: readonly HoverPoint[] }) {
  const [index, setIndex] = useState<number | null>(null);
  const active = index === null ? null : (points[index] ?? null);

  function onMove(event: MouseEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width === 0 || points.length === 0) return;
    const ratio = (event.clientX - box.left) / box.width;
    const nearest = Math.round(ratio * (points.length - 1));
    setIndex(Math.min(points.length - 1, Math.max(0, nearest)));
  }

  const left = index === null || points.length < 2 ? 0 : (index / (points.length - 1)) * 100;

  return (
    <div className="absolute inset-0" onMouseMove={onMove} onMouseLeave={() => setIndex(null)}>
      {active && (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute top-0 bottom-0 w-px bg-fg/25"
            style={{ left: `${left}%` }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-ctl border border-border bg-card px-2 py-1 whitespace-nowrap shadow-overlay"
            style={{ left: `${Math.min(86, Math.max(14, left))}%` }}
          >
            <div className="text-xs text-muted">{active.label}</div>
            <div className="text-sm font-medium tabular-nums">{active.value}</div>
            {active.note && <div className="text-xs text-muted tabular-nums">{active.note}</div>}
            {active.rows && active.rows.length > 0 && (
              <div className="mt-1 flex flex-col gap-0.5 border-t border-border pt-1">
                {active.rows.map((row) => (
                  <div key={row.label} className="flex items-center gap-1.5 text-xs">
                    <span className="size-2 shrink-0 rounded-[2px]" style={{ background: row.color }} />
                    <span className="text-muted">{row.label}</span>
                    <span className="ml-auto pl-3 tabular-nums">{row.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
