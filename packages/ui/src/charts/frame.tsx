// The frame every axis chart is drawn in: the plot with its grid and hover, the value labels at the
// right, the step labels below, and a text summary, so the chart is not the only way to the numbers.
import type { ReactNode } from "react";
import { ChartHover, type HoverPoint } from "../chart-hover";
import { path, type Stroke } from "./geometry";

export const PLOT_WIDTH = 720;

export function ChartFrame({
  height,
  yLabels,
  xLabels,
  summary,
  hover,
  slots = false,
  grid = true,
  children,
}: {
  height: number;
  yLabels: readonly string[];
  xLabels: readonly string[];
  summary: string;
  hover?: readonly HoverPoint[];
  /** Bars sit in slots, not on points: the crosshair is placed slot by slot to match. */
  slots?: boolean;
  /** The horizontal lines behind the plot, one per value label. */
  grid?: boolean;
  children: ReactNode;
}) {
  return (
    <figure className="flex flex-col gap-2">
      <div className="flex gap-3">
        <div className="relative min-w-0 flex-1" style={{ height }}>
          {grid && (
            <div aria-hidden className="absolute inset-0 flex flex-col justify-between">
              {yLabels.map((_label, index) => (
                <div key={index} className="border-t border-border/60" />
              ))}
            </div>
          )}
          {children}
          {hover && hover.length > 0 && <ChartHover points={hover} slots={slots} />}
        </div>
        <div
          aria-hidden
          className="flex shrink-0 flex-col justify-between text-right text-xs text-faint tabular-nums"
          style={{ height }}
        >
          {yLabels.map((label, index) => (
            <span key={index}>{label}</span>
          ))}
        </div>
      </div>
      <div aria-hidden className="flex justify-between text-xs text-faint">
        {xLabels.map((label, index) => (
          <span key={index}>{label}</span>
        ))}
      </div>
      <figcaption className="sr-only">{summary}</figcaption>
    </figure>
  );
}

/** The drawing surface: stretched to the frame, decorative, read through the summary. */
export function Plot({
  height,
  className = "relative h-full w-full",
  children,
}: {
  height: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <svg viewBox={`0 0 ${PLOT_WIDTH} ${height}`} preserveAspectRatio="none" aria-hidden className={className}>
      {children}
    </svg>
  );
}

/** The main line of a chart, dashed where it stands on estimates. */
export function Strokes({ strokes, color }: { strokes: readonly Stroke[]; color: string }) {
  return strokes.map((stroke, index) => (
    <polyline
      key={index}
      points={path(stroke.points)}
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeDasharray={stroke.dashed ? "5 4" : undefined}
      vectorEffect="non-scaling-stroke"
    />
  ));
}
