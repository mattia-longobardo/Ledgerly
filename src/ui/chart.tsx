import { cn } from "./cn";

export interface Series {
  /** One value per step; `null` is a gap, never a zero. */
  values: readonly (number | null)[];
  color?: string;
  label?: string;
}

interface Box {
  width: number;
  height: number;
  pad: number;
}

/** The value range a chart is drawn against, padded so a flat line is not glued to an edge. */
export function extentOf(series: readonly Series[]): { low: number; high: number } {
  const known = series.flatMap((one) => one.values.filter((value): value is number => value !== null));
  if (known.length === 0) return { low: 0, high: 1 };
  const low = Math.min(...known, 0);
  const high = Math.max(...known);
  if (high === low) return { low, high: low + 1 };
  return { low, high };
}

function scale(value: number, { low, high }: { low: number; high: number }, box: Box): number {
  const usable = box.height - box.pad * 2;
  return box.pad + usable - ((value - low) / (high - low)) * usable;
}

function xOf(index: number, count: number, box: Box): number {
  if (count <= 1) return box.width / 2;
  return box.pad + (index * (box.width - box.pad * 2)) / (count - 1);
}

/**
 * A series as the runs of consecutive known values it is made of. A gap breaks the line instead of
 * being drawn through, so a month with no balance is visibly missing rather than invented.
 */
export function segmentsOf(
  values: readonly (number | null)[],
  extent: { low: number; high: number },
  box: Box,
): { x: number; y: number }[][] {
  const runs: { x: number; y: number }[][] = [];
  let run: { x: number; y: number }[] = [];
  values.forEach((value, index) => {
    if (value === null) {
      if (run.length > 0) runs.push(run);
      run = [];
      return;
    }
    run.push({ x: xOf(index, values.length, box), y: scale(value, extent, box) });
  });
  if (run.length > 0) runs.push(run);
  return runs;
}

const path = (run: { x: number; y: number }[]) =>
  run.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");

/** The same run closed down to the baseline, for the soft fill under the line. */
const areaPath = (run: { x: number; y: number }[], floor: number) =>
  [
    `M ${run[0].x.toFixed(1)},${floor.toFixed(1)}`,
    ...run.map((point) => `L ${point.x.toFixed(1)},${point.y.toFixed(1)}`),
    `L ${run[run.length - 1].x.toFixed(1)},${floor.toFixed(1)}`,
    "Z",
  ].join(" ");

/** A row-sized trend line: no axes, no interaction, just the shape of the last months. */
export function Sparkline({
  values,
  tone = "var(--muted)",
  className,
}: {
  values: readonly (number | null)[];
  tone?: string;
  className?: string;
}) {
  const box: Box = { width: 100, height: 24, pad: 2 };
  const extent = extentOf([{ values }]);
  const runs = segmentsOf(values, extent, box);
  return (
    <svg
      viewBox="0 0 100 24"
      aria-hidden
      className={cn("h-5 w-[60px] overflow-visible", className)}
      preserveAspectRatio="none"
    >
      {runs.map((run, index) => (
        <polyline
          key={index}
          points={path(run)}
          fill="none"
          stroke={tone}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

/**
 * The filled trend of the design: one accent line over a soft area, with the horizontal grid and
 * the axis labels the caller supplies. The figure carries a text summary, so the chart is not the
 * only way to read the numbers.
 */
export function AreaLine({
  values,
  summary,
  yLabels,
  xLabels,
  height = 200,
}: {
  values: readonly (number | null)[];
  summary: string;
  yLabels: readonly string[];
  xLabels: readonly string[];
  height?: number;
}) {
  const box: Box = { width: 720, height, pad: 6 };
  const extent = extentOf([{ values }]);
  const runs = segmentsOf(values, extent, box);
  const floor = box.height - box.pad;

  return (
    <figure className="flex flex-col gap-2">
      <div className="flex gap-3">
        <div className="relative min-w-0 flex-1" style={{ height }}>
          <div aria-hidden className="absolute inset-0 flex flex-col justify-between">
            {yLabels.map((_, index) => (
              <div key={index} className="border-t border-border/60" />
            ))}
          </div>
          <svg
            viewBox={`0 0 720 ${height}`}
            preserveAspectRatio="none"
            aria-hidden
            className="relative h-full w-full"
          >
            {runs.map((run, index) => (
              <g key={index}>
                {run.length > 1 && <path d={areaPath(run, floor)} fill="var(--soft)" opacity={0.6} />}
                <polyline
                  points={path(run)}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            ))}
          </svg>
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

/** One line per account, on a shared scale: the Accounts page's 24-month comparison. */
export function MultiLine({
  series,
  summary,
  yLabels,
  xLabels,
  height = 180,
}: {
  series: readonly Series[];
  summary: string;
  yLabels: readonly string[];
  xLabels: readonly string[];
  height?: number;
}) {
  const box: Box = { width: 720, height, pad: 6 };
  const extent = extentOf(series);

  return (
    <figure className="flex flex-col gap-2">
      <div className="flex gap-3">
        <div className="relative min-w-0 flex-1" style={{ height }}>
          <div aria-hidden className="absolute inset-0 flex flex-col justify-between">
            {yLabels.map((_, index) => (
              <div key={index} className="border-t border-border/60" />
            ))}
          </div>
          <svg
            viewBox={`0 0 720 ${height}`}
            preserveAspectRatio="none"
            aria-hidden
            className="relative h-full w-full"
          >
            {series.map((one, index) =>
              segmentsOf(one.values, extent, box).map((run, runIndex) => (
                <polyline
                  key={`${index}-${runIndex}`}
                  points={path(run)}
                  fill="none"
                  stroke={one.color ?? "var(--accent)"}
                  strokeWidth={1.5}
                  vectorEffect="non-scaling-stroke"
                />
              )),
            )}
          </svg>
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

/** A share bar: one segment per account, widths proportional to their balances. */
export function CompositionBar({
  parts,
}: {
  parts: readonly { label: string; share: number; color: string }[];
}) {
  return (
    <div aria-hidden className="flex h-2.5 overflow-hidden rounded-[5px] bg-track">
      {parts.map((part) => (
        <div
          key={part.label}
          title={part.label}
          style={{ width: `${(part.share * 100).toFixed(2)}%`, background: part.color }}
        />
      ))}
    </div>
  );
}
