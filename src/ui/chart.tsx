import { ChartHover, type HoverPoint } from "./chart-hover";
import { cn } from "./cn";

export interface Series {
  /** One value per step; `null` is a gap, never a zero. */
  values: readonly (number | null)[];
  color?: string;
  label?: string;
  /** Drawn dashed: a reference line (what was paid in) beside a measured one. */
  dashed?: boolean;
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

/** A piece of a line drawn in one style: solid, or dashed where the values are estimates. */
export interface Stroke {
  points: { x: number; y: number }[];
  dashed: boolean;
}

/**
 * A series as the strokes it is drawn with (F2.5). A step between two months is dashed when either
 * end is an estimate — a month end rebuilt from the movements rather than read — so the line says
 * where it stops knowing and starts reconstructing. Consecutive steps of one style are one stroke,
 * and neighbouring strokes share their meeting point, so the line has no gap where the style
 * changes. A gap in the values still breaks the line, as in `segmentsOf`.
 */
export function strokesOf(
  values: readonly (number | null)[],
  estimated: readonly boolean[],
  extent: { low: number; high: number },
  box: Box,
): Stroke[] {
  const strokes: Stroke[] = [];
  for (let i = 0; i + 1 < values.length; i += 1) {
    const from = values[i];
    const to = values[i + 1];
    if (from === null || to === null) continue;
    const dashed = estimated[i] === true || estimated[i + 1] === true;
    const start = { x: xOf(i, values.length, box), y: scale(from, extent, box) };
    const end = { x: xOf(i + 1, values.length, box), y: scale(to, extent, box) };
    const last = strokes.at(-1);
    const joined = last && last.dashed === dashed && last.points.at(-1)?.x === start.x;
    if (joined) last.points.push(end);
    else strokes.push({ points: [start, end], dashed });
  }
  return strokes;
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
  hover,
  estimated,
}: {
  values: readonly (number | null)[];
  summary: string;
  yLabels: readonly string[];
  xLabels: readonly string[];
  height?: number;
  hover?: readonly HoverPoint[];
  /** Per value, whether it is an estimate (F2.5): those steps of the line are dashed. */
  estimated?: readonly boolean[];
}) {
  const box: Box = { width: 720, height, pad: 6 };
  const extent = extentOf([{ values }]);
  const runs = segmentsOf(values, extent, box);
  const strokes = strokesOf(values, estimated ?? [], extent, box);
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
            {runs.map((run, index) =>
              run.length > 1 ? (
                <path key={index} d={areaPath(run, floor)} fill="var(--soft)" opacity={0.6} />
              ) : null,
            )}
            {strokes.map((stroke, index) => (
              <polyline
                key={index}
                points={path(stroke.points)}
                fill="none"
                stroke="var(--accent)"
                strokeWidth={2}
                strokeDasharray={stroke.dashed ? "5 4" : undefined}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
          {hover && hover.length > 0 && <ChartHover points={hover} />}
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

/** One band of a stacked chart: where it starts and where it ends at each step. */
export interface Band {
  lower: (number | null)[];
  upper: (number | null)[];
}

/**
 * Layers piled one on the other, in the order given (the first at the bottom), so the top edge of
 * the last is the total. Positive values pile up from zero, negative ones down from it, so a
 * credit card never eats into the accounts above the line. A layer with no value at a step counts
 * as nothing there; a step no layer knows is a gap in every band, never a fall to zero.
 */
export function stackLayers(
  layers: readonly (readonly (number | null)[])[],
  length: number,
): { bands: Band[]; top: (number | null)[]; bottom: (number | null)[] } {
  const bands: Band[] = layers.map(() => ({ lower: [], upper: [] }));
  const top: (number | null)[] = [];
  const bottom: (number | null)[] = [];
  for (let i = 0; i < length; i += 1) {
    const known = layers.some((values) => values[i] !== null && values[i] !== undefined);
    let above = 0;
    let below = 0;
    layers.forEach((values, index) => {
      if (!known) {
        bands[index].lower.push(null);
        bands[index].upper.push(null);
        return;
      }
      const value = values[i] ?? 0;
      const base = value < 0 ? below : above;
      bands[index].lower.push(base);
      bands[index].upper.push(base + value);
      if (value < 0) below += value;
      else above += value;
    });
    top.push(known ? above : null);
    bottom.push(known ? below : null);
  }
  return { bands, top, bottom };
}

/** A band as closed paths, one per run of known steps: along the top, back along the bottom. */
function bandPaths(band: Band, extent: { low: number; high: number }, box: Box): string[] {
  const paths: string[] = [];
  let run: number[] = [];
  const close = () => {
    if (run.length > 1) {
      const count = band.upper.length;
      const along = run.map(
        (i) => `${xOf(i, count, box).toFixed(1)},${scale(band.upper[i] as number, extent, box).toFixed(1)}`,
      );
      const back = [...run]
        .reverse()
        .map(
          (i) => `${xOf(i, count, box).toFixed(1)},${scale(band.lower[i] as number, extent, box).toFixed(1)}`,
        );
      paths.push(`M ${along.join(" L ")} L ${back.join(" L ")} Z`);
    }
    run = [];
  };
  band.upper.forEach((value, i) => {
    if (value === null) close();
    else run.push(i);
  });
  close();
  return paths;
}

/**
 * The net worth of the design, account by account (F2.5): one band per account in its own colour,
 * piled so the top edge is the total, and the total drawn over them as the figure's main line —
 * dashed where it stands on month ends rebuilt from the movements. The figure carries a text
 * summary, so the chart is not the only way to the numbers.
 */
export function StackedArea({
  layers,
  total,
  estimated,
  summary,
  yLabels,
  xLabels,
  height = 240,
  hover,
}: {
  /** Bottom first. */
  layers: readonly { label: string; color: string; values: readonly (number | null)[] }[];
  total: readonly (number | null)[];
  estimated?: readonly boolean[];
  summary: string;
  yLabels: readonly string[];
  xLabels: readonly string[];
  height?: number;
  hover?: readonly HoverPoint[];
}) {
  const box: Box = { width: 720, height, pad: 6 };
  const { bands, top, bottom } = stackLayers(
    layers.map((layer) => layer.values),
    total.length,
  );
  const extent = extentOf([{ values: top }, { values: bottom }, { values: total }]);
  const strokes = strokesOf(total, estimated ?? [], extent, box);

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
            {bands.map((band, index) =>
              bandPaths(band, extent, box).map((d, runIndex) => (
                <path
                  key={`${index}-${runIndex}`}
                  data-band={layers[index].label}
                  d={d}
                  fill={layers[index].color}
                  fillOpacity={0.55}
                  stroke={layers[index].color}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              )),
            )}
            {strokes.map((stroke, index) => (
              <polyline
                key={index}
                points={path(stroke.points)}
                fill="none"
                stroke="var(--fg)"
                strokeWidth={2}
                strokeDasharray={stroke.dashed ? "5 4" : undefined}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
          {hover && hover.length > 0 && <ChartHover points={hover} />}
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
                  strokeDasharray={one.dashed ? "4 4" : undefined}
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

/**
 * Month-over-month change as bars around a zero line (spec §8.3): gains above, losses below. A
 * month with no comparable value draws nothing rather than a bar of height zero, which would read
 * as "no change" instead of "not known".
 */
export function Bars({
  values,
  summary,
  yLabels,
  xLabels,
  height = 240,
}: {
  values: readonly (number | null)[];
  summary: string;
  yLabels: readonly string[];
  xLabels: readonly string[];
  height?: number;
}) {
  const known = values.filter((value): value is number => value !== null);
  const reach = Math.max(1, ...known.map(Math.abs));
  const zero = height / 2;
  const width = 720;
  const slot = width / Math.max(1, values.length);
  const barWidth = Math.max(2, slot * 0.6);

  return (
    <figure className="flex flex-col gap-2">
      <div className="flex gap-3">
        <div className="relative min-w-0 flex-1" style={{ height }}>
          <svg
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            aria-hidden
            className="h-full w-full"
          >
            <line x1={0} x2={width} y1={zero} y2={zero} stroke="var(--border)" strokeWidth={1} />
            {values.map((value, index) => {
              // No change is no bar: a hairline on zero, one per quiet day, read as a dashed line.
              if (value === null || value === 0) return null;
              const size = (Math.abs(value) / reach) * (zero - 4);
              return (
                <rect
                  key={index}
                  x={index * slot + (slot - barWidth) / 2}
                  y={value >= 0 ? zero - size : zero}
                  width={barWidth}
                  height={Math.max(1, size)}
                  fill={value >= 0 ? "var(--pos)" : "var(--neg)"}
                />
              );
            })}
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

/**
 * Columns from zero, one per period (spec §8.3 MiniBars; the design's "Earmarked · 12 months"). The
 * top of the scale is `target` when there is one, drawn as a dashed line; otherwise the highest
 * value with some headroom. A `null` period draws no column: unknown, not zero. Each column carries
 * its own tooltip (`labels`).
 */
export function MiniBars({
  values,
  labels,
  xLabels,
  summary,
  target = null,
  height = 120,
}: {
  values: readonly (number | null)[];
  labels: readonly string[];
  xLabels: readonly string[];
  summary: string;
  target?: number | null;
  height?: number;
}) {
  const known = values.filter((value): value is number => value !== null && value > 0);
  const top = target !== null && target > 0 ? target : Math.max(1, ...known) * 1.15;
  const scale = (value: number) => Math.min(1, Math.max(0, value) / top) * 100;

  return (
    <figure className="flex flex-col gap-2">
      <div className="relative" style={{ height }}>
        {target !== null && (
          <div
            aria-hidden
            data-testid="mini-bars-target"
            className="absolute inset-x-0 top-0 border-t border-dashed border-muted"
          />
        )}
        <div
          className="grid h-full items-end gap-1.5"
          style={{ gridTemplateColumns: `repeat(${Math.max(1, values.length)}, minmax(0, 1fr))` }}
        >
          {values.map((value, index) => (
            <div
              key={index}
              title={labels[index]}
              data-testid="mini-bar"
              className="rounded-t-[3px] bg-accent opacity-85"
              style={{ height: value === null ? 0 : `${scale(value)}%` }}
            />
          ))}
        </div>
      </div>
      <div
        aria-hidden
        className="grid text-center text-xs text-faint"
        style={{ gridTemplateColumns: `repeat(${Math.max(1, xLabels.length)}, minmax(0, 1fr))` }}
      >
        {xLabels.map((label, index) => (
          <span key={index} className="truncate">
            {label}
          </span>
        ))}
      </div>
      <figcaption className="sr-only">{summary}</figcaption>
    </figure>
  );
}
