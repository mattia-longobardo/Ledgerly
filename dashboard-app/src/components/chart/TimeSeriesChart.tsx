"use client";

import uPlot from "uplot";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../ui/cn";
import { formatEur, formatMonth, formatNumber } from "@/lib/format";
import type { Series } from "@/lib/contracts";

export interface TimeSeriesChartProps {
  series: readonly Series[];
  /** Accessible name for the plot and its data table. */
  label: string;
  height?: number;
  /** 8 % fill under the first series. */
  area?: boolean;
  formatValue?: (value: number | null) => string;
  emptyMessage?: string;
  className?: string;
}

interface ChartTokens {
  fg: string;
  fgMuted: string;
  border: string;
  surface: string;
  chart: string[];
  mono: string;
}

const FALLBACK_MONO = "ui-monospace, monospace";

/** Hex fallbacks fire only if the token layer never loaded; canvas cannot read `var()`. */
function readTokens(): ChartTokens {
  const cs = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    fg: get("--color-fg", "#15181d"),
    fgMuted: get("--color-fg-muted", "#5c6572"),
    border: get("--color-border", "#dfe3e8"),
    surface: get("--color-surface-raised", "#ffffff"),
    chart: [1, 2, 3, 4, 5, 6].map((i) => get(`--color-chart-${i}`, "#0e7490")),
    mono: get("--font-mono", FALLBACK_MONO),
  };
}

/** Canvas fillStyle needs a concrete colour; `color-mix()` is not portable there. */
function withAlpha(color: string, alpha: number): string {
  const hex = color.trim();
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (!match) return hex;
  const body = match[1] ?? "";
  const full =
    body.length === 3
      ? body
          .split("")
          .map((c) => c + c)
          .join("")
      : body;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const TICK_MONTH = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" });

function monthTick(seconds: number): string {
  const d = new Date(seconds * 1000);
  const month = TICK_MONTH.format(d).toUpperCase();
  return d.getUTCMonth() === 0 ? `${month} ’${String(d.getUTCFullYear()).slice(2)}` : month;
}

function compactValue(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${formatNumber(Math.round(v / 100_000) / 10)}M`;
  if (abs >= 1_000) return `${formatNumber(Math.round(v / 1_000))}k`;
  return formatNumber(Math.round(v));
}

function monthKey(month: string): string {
  return `${month.slice(0, 7)}-01`;
}

function monthToSeconds(month: string): number {
  return Date.parse(`${monthKey(month)}T12:00:00Z`) / 1000;
}

/** Structural uPlot CSS, token-coloured; the shipped stylesheet hard-codes hues. */
const PLOT_CSS = `
.tsc .uplot, .tsc .uplot *, .tsc .uplot *::before, .tsc .uplot *::after { box-sizing: border-box; }
.tsc .uplot { width: 100%; font-family: var(--font-mono); line-height: 1.5; }
.tsc .u-wrap { position: relative; user-select: none; }
.tsc .u-over, .tsc .u-under { position: absolute; }
.tsc .u-under { overflow: hidden; }
.tsc .uplot canvas { display: block; position: relative; width: 100%; height: 100%; }
.tsc .u-axis { position: absolute; }
.tsc .u-select { position: absolute; pointer-events: none; background: color-mix(in srgb, var(--color-fg) 7%, transparent); }
.tsc .u-cursor-x, .tsc .u-cursor-y { position: absolute; left: 0; top: 0; pointer-events: none; will-change: transform; }
.tsc .u-hz .u-cursor-x { height: 100%; border-right: 1px dashed var(--color-fg-muted); }
.tsc .u-hz .u-cursor-y { width: 100%; border-bottom: 1px dashed var(--color-fg-muted); }
.tsc .u-cursor-pt { position: absolute; top: 0; left: 0; border-radius: 50%; border: 0 solid; pointer-events: none; will-change: transform; background-clip: padding-box !important; }
.tsc .u-axis.u-off, .tsc .u-select.u-off, .tsc .u-cursor-x.u-off, .tsc .u-cursor-y.u-off, .tsc .u-cursor-pt.u-off { display: none; }
`;

interface HoverState {
  idx: number;
  x: number;
}

export function TimeSeriesChart({
  series,
  label,
  height = 200,
  area = true,
  formatValue = (v) => formatEur(v),
  emptyMessage = "Not enough history yet",
  className,
}: TimeSeriesChartProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const seriesRef = useRef(series);
  seriesRef.current = series;
  const [hover, setHover] = useState<HoverState | null>(null);
  const [themeTick, setThemeTick] = useState(0);

  const signature = series
    .map((s) => `${s.key}|${s.points.map((p) => `${p.month}=${p.value ?? ""}`).join(",")}`)
    .join("||");

  const model = useMemo(() => {
    const months = [...new Set(series.flatMap((s) => s.points.map((p) => p.month)))].sort();
    const xs = months.map(monthToSeconds);
    const cols = series.map((s) => {
      const byMonth = new Map(s.points.map((p) => [p.month, p.value] as const));
      return months.map((m) => {
        const v = byMonth.get(m);
        return v === undefined || v === null || !Number.isFinite(v) ? null : v;
      });
    });
    return { months, xs, cols };
    // Keyed on the value signature so an inline `series` literal does not
    // rebuild the plot on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const enoughHistory = model.xs.length >= 2;

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const bump = () => setThemeTick((t) => t + 1);
    media.addEventListener("change", bump);
    const observer = new MutationObserver(bump);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      media.removeEventListener("change", bump);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !enoughHistory) return;

    const tokens = readTokens();
    const plotSeries = seriesRef.current;
    const font = `500 10px ${tokens.mono || FALLBACK_MONO}`;
    const axisBase = {
      stroke: tokens.fgMuted,
      font,
      grid: { stroke: tokens.border, width: 1 },
      ticks: { stroke: tokens.border, width: 1, size: 4 },
      border: { stroke: tokens.border, width: 1 },
    } as const;

    const opts: uPlot.Options = {
      width: host.clientWidth || 320,
      height,
      padding: [10, 8, 0, 0],
      legend: { show: false },
      cursor: {
        x: true,
        y: false,
        points: {
          size: 6,
          width: 1,
          fill: () => tokens.surface,
          stroke: (_u, i) => tokens.chart[(i - 1) % tokens.chart.length] ?? tokens.fg,
        },
        drag: { x: false, y: false, setScale: false },
      },
      scales: { x: { time: true } },
      axes: [
        { ...axisBase, size: 28, values: (_u, splits) => splits.map((s) => monthTick(s)) },
        {
          ...axisBase,
          size: 48,
          values: (_u, splits) => splits.map((s) => compactValue(s)),
        },
      ],
      series: [
        {},
        ...plotSeries.map((s, i) => {
          const stroke = tokens.chart[i % tokens.chart.length] ?? tokens.fg;
          return {
            label: s.label,
            stroke,
            width: 1,
            spanGaps: false,
            ...(area && i === 0 ? { fill: withAlpha(stroke, 0.08) } : {}),
          } satisfies uPlot.Series;
        }),
      ],
      hooks: {
        setCursor: [
          (u) => {
            const idx = u.cursor.idx;
            const left = u.cursor.left ?? -1;
            if (idx === null || idx === undefined || left < 0) {
              setHover(null);
              return;
            }
            setHover({ idx, x: u.over.offsetLeft + left });
          },
        ],
      },
    };

    const data = [model.xs, ...model.cols] as unknown as uPlot.AlignedData;
    const plot = new uPlot(opts, data, host);

    // uPlot binds mouse events only; touch gets its own handling so the
    // crosshair works on tap-and-hold without stealing vertical scrolling.
    const over = plot.over;
    over.style.touchAction = "pan-y";
    let holdTimer: number | null = null;
    let active = false;
    let startX = 0;
    let startY = 0;

    const moveTo = (clientX: number) => {
      const rect = over.getBoundingClientRect();
      plot.setCursor({ left: clientX - rect.left, top: rect.height / 2 }, true);
    };
    const clear = () => {
      active = false;
      plot.setCursor({ left: -10, top: -10 }, true);
    };

    const onTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      startX = touch.clientX;
      startY = touch.clientY;
      holdTimer = window.setTimeout(() => {
        active = true;
        moveTo(startX);
      }, 120);
    };
    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      if (!active) {
        const dx = Math.abs(touch.clientX - startX);
        const dy = Math.abs(touch.clientY - startY);
        if (dy > dx) {
          if (holdTimer !== null) window.clearTimeout(holdTimer);
          return;
        }
        active = true;
        if (holdTimer !== null) window.clearTimeout(holdTimer);
      }
      event.preventDefault();
      moveTo(touch.clientX);
    };
    const onTouchEnd = () => {
      if (holdTimer !== null) window.clearTimeout(holdTimer);
      if (active) window.setTimeout(clear, 1200);
      active = false;
    };

    over.addEventListener("touchstart", onTouchStart, { passive: true });
    over.addEventListener("touchmove", onTouchMove, { passive: false });
    over.addEventListener("touchend", onTouchEnd);
    over.addEventListener("touchcancel", onTouchEnd);

    let frame = 0;
    const resize = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const width = Math.round(entry.contentRect.width);
      if (width <= 0) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => plot.setSize({ width, height }));
    });
    resize.observe(host);

    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      if (holdTimer !== null) window.clearTimeout(holdTimer);
      over.removeEventListener("touchstart", onTouchStart);
      over.removeEventListener("touchmove", onTouchMove);
      over.removeEventListener("touchend", onTouchEnd);
      over.removeEventListener("touchcancel", onTouchEnd);
      plot.destroy();
      setHover(null);
    };
  }, [model, height, area, enoughHistory, themeTick]);

  const hoveredMonth = hover === null ? null : model.months[hover.idx];

  if (!enoughHistory) {
    const only = series[0]?.points.find((p) => p.value !== null)?.value ?? null;
    return (
      <div
        className={cn(
          "flex flex-col items-start justify-center gap-1 rounded-md border border-border bg-surface px-4",
          className,
        )}
        style={{ minHeight: height }}
      >
        <span className="num text-display-sm text-fg">{formatValue(only)}</span>
        <span className="text-body-sm text-fg-muted">{emptyMessage}</span>
      </div>
    );
  }

  return (
    <figure className={cn("tsc relative m-0", className)}>
      <div ref={hostRef} aria-hidden style={{ height }} />

      {hover !== null && typeof hoveredMonth === "string" && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute top-2 z-10 min-w-32 -translate-x-1/2 rounded-md border border-border bg-surface-raised px-2.5 py-2 shadow-overlay"
          style={{ left: hover.x }}
        >
          <div className="num text-caption tracking-wide text-fg-muted uppercase">
            {formatMonth(monthKey(hoveredMonth))}
          </div>
          {series.map((s, i) => (
            <div key={s.key} className="flex items-baseline justify-between gap-3">
              <span className="text-caption text-fg-muted">{s.label}</span>
              <span className="num text-body-sm text-fg">
                {formatValue(model.cols[i]?.[hover.idx] ?? null)}
              </span>
            </div>
          ))}
        </div>
      )}

      <figcaption className="sr-only">{label}</figcaption>
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            {series.map((s) => (
              <th key={s.key} scope="col">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {model.months.map((month, row) => (
            <tr key={month}>
              <th scope="row">{formatMonth(monthKey(month))}</th>
              {series.map((s, i) => (
                <td key={s.key}>{formatValue(model.cols[i]?.[row] ?? null)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <style href="tsc-uplot" precedence="medium">
        {PLOT_CSS}
      </style>
    </figure>
  );
}
