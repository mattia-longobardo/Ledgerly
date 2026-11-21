import type { HoverPoint } from "../chart-hover";
import { ChartFrame, Plot, PLOT_WIDTH } from "./frame";
import { type Box, type Extent, extentOf, path, type Point, scale } from "./geometry";
import { type Band, stackLayers } from "./stack";

interface Layer {
  key: string;
  label: string;
  color: string;
  values: readonly (number | null)[];
  estimated?: readonly boolean[];
}

/** Where the bars and the line land: the scale with zero in it, the slots and the line's runs. */
function layoutOf(layers: readonly Layer[], line: readonly (number | null)[], height: number) {
  const count = line.length;
  const box: Box = { width: PLOT_WIDTH, height, pad: 6 };
  const { bands, top, bottom } = stackLayers(
    layers.map((layer) => layer.values),
    count,
  );
  // Zero always shows, so an all-loss period still has its baseline: the range of `axisLabels`.
  const extent = extentOf([{ values: top }, { values: bottom }, { values: line }, { values: [0] }]);
  const slot = PLOT_WIDTH / Math.max(1, count);
  const runs: Point[][] = [];
  let run: Point[] = [];
  line.forEach((value, index) => {
    if (value === null) {
      if (run.length > 0) runs.push(run);
      run = [];
    } else run.push({ x: index * slot + slot / 2, y: scale(value, extent, box) });
  });
  if (run.length > 0) runs.push(run);
  return { count, box, bands, extent, slot, barWidth: Math.max(2, slot * 0.6), runs };
}

/** Each layer's piece of each bar; an estimated piece has a dashed edge and a lighter fill. */
function Pieces({
  layers,
  bands,
  extent,
  box,
  slot,
  barWidth,
}: {
  layers: readonly Layer[];
  bands: readonly Band[];
  extent: Extent;
  box: Box;
  slot: number;
  barWidth: number;
}) {
  return bands.map((band, layerIndex) =>
    band.upper.map((upper, index) => {
      const lower = band.lower[index];
      if (upper === null || lower === null || upper === lower) return null;
      const top = scale(Math.max(upper, lower), extent, box);
      const bottom = scale(Math.min(upper, lower), extent, box);
      const layer = layers[layerIndex];
      const estimated = layer.estimated?.[index] === true;
      return (
        <rect
          key={`${layerIndex}-${index}`}
          data-series={layer.key}
          x={index * slot + (slot - barWidth) / 2}
          y={top}
          width={barWidth}
          height={Math.max(1, bottom - top)}
          fill={layer.color}
          fillOpacity={estimated ? 0.45 : 0.85}
          stroke={estimated ? layer.color : undefined}
          strokeDasharray={estimated ? "4 3" : undefined}
          vectorEffect="non-scaling-stroke"
        />
      );
    }),
  );
}

/** The running total over the bars: a lone known point is a dot, a run a line. */
function TotalLine({ runs }: { runs: readonly Point[][] }) {
  return runs.map((points, index) =>
    points.length === 1 ? (
      <circle key={index} cx={points[0].x} cy={points[0].y} r={3} fill="var(--fg)" />
    ) : (
      <polyline
        key={index}
        points={path(points)}
        fill="none"
        stroke="var(--fg)"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
    ),
  );
}

/** The first bars with no data, as a grey band with its words. */
function Unavailable({ slots, label, count }: { slots: number; label: string; count: number }) {
  return (
    <div
      aria-hidden
      className="absolute inset-y-0 left-0 flex items-center justify-center rounded-sm bg-hover/70 p-1 text-center text-xs text-muted"
      style={{ width: `${(Math.min(slots, count) / Math.max(1, count)) * 100}%` }}
    >
      <span className="line-clamp-3">{label}</span>
    </div>
  );
}

/** Per bar, money in (↑), out (↓) or both, over it. */
function Markers({ markers, count }: { markers: readonly ("in" | "out" | "both" | null)[]; count: number }) {
  return markers.map((marker, index) =>
    marker === null ? null : (
      <span
        key={index}
        aria-hidden
        className="absolute top-0 -translate-x-1/2 text-xs leading-none font-semibold text-muted"
        style={{ left: `${((index + 0.5) / Math.max(1, count)) * 100}%` }}
      >
        {marker === "in" ? "↑" : marker === "out" ? "↓" : "↕"}
      </span>
    ),
  );
}

/**
 * Bars piled by series around a zero line, and a line over them (docs/design/investments-ux.md §3.1):
 * the P&L of each interval, service by service — gains above zero, losses below, as `stackLayers`
 * piles them — and the running total from zero at the start of the period. A layer with no value
 * in a slot draws nothing there: unknown, not zero. An estimated piece is drawn with a dashed edge
 * and a lighter fill. Each piece carries `data-series`, for a `HighlightScope` around the chart.
 */
export function StackedBars({
  layers,
  line,
  summary,
  yLabels,
  xLabels,
  height = 220,
  hover,
  unavailable,
  markers,
}: {
  /** Bottom first. */
  layers: readonly Layer[];
  line: readonly (number | null)[];
  summary: string;
  yLabels: readonly string[];
  xLabels: readonly string[];
  height?: number;
  hover?: readonly HoverPoint[];
  /** The first `slots` bars have no data: a grey band with its words, never a zero. */
  unavailable?: { slots: number; label: string };
  /** Per bar, money in (↑), out (↓) or both: drawn over it, words in `summary`. */
  markers?: readonly ("in" | "out" | "both" | null)[];
}) {
  const { count, runs, ...layout } = layoutOf(layers, line, height);
  const zero = scale(0, layout.extent, layout.box);
  return (
    <ChartFrame height={height} yLabels={yLabels} xLabels={xLabels} summary={summary} hover={hover} slots>
      <Plot height={height}>
        <line x1={0} x2={PLOT_WIDTH} y1={zero} y2={zero} stroke="var(--border)" strokeWidth={1} />
        <Pieces layers={layers} {...layout} />
        <TotalLine runs={runs} />
      </Plot>
      {unavailable && unavailable.slots > 0 && <Unavailable {...unavailable} count={count} />}
      {markers && <Markers markers={markers} count={count} />}
    </ChartFrame>
  );
}
