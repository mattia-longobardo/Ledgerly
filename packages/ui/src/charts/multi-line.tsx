import type { HoverPoint } from "../chart-hover";
import { ChartFrame, Plot, PLOT_WIDTH } from "./frame";
import {
  type Box,
  type Extent,
  extentOf,
  path,
  scale,
  segmentsOf,
  type Series,
  stepped,
  strokesOf,
  xOf,
} from "./geometry";

type Gap = { upper: readonly (number | null)[]; lower: readonly (number | null)[] };

/** The gap between two series, step by step: green where `upper` is above `lower`, red below. */
function GapBand({ band, extent, box }: { band: Gap; extent: Extent; box: Box }) {
  const count = band.upper.length;
  return band.upper.map((upper, index) => {
    const lower = band.lower[index];
    if (index + 1 >= count || upper === null || lower === null || upper === lower) return null;
    const top = scale(Math.max(upper, lower), extent, box);
    const bottom = scale(Math.min(upper, lower), extent, box);
    const x = xOf(index, count, box);
    return (
      <rect
        key={index}
        data-band={upper > lower ? "pos" : "neg"}
        x={x}
        y={top}
        width={xOf(index + 1, count, box) - x}
        height={Math.max(1, bottom - top)}
        fill={upper > lower ? "var(--pos-bg)" : "var(--neg-bg)"}
      />
    );
  });
}

/** One series: by strokes where some steps are estimates, by runs of known values otherwise. */
function SeriesLine({ one, extent, box }: { one: Series; extent: Extent; box: Box }) {
  const line = (key: number, points: string, dashed: boolean) => (
    <polyline
      key={key}
      points={points}
      fill="none"
      stroke={one.color ?? "var(--accent)"}
      strokeWidth={1.5}
      strokeDasharray={dashed ? "4 4" : undefined}
      vectorEffect="non-scaling-stroke"
    />
  );
  if (one.estimated?.some(Boolean)) {
    return strokesOf(one.values, one.estimated, extent, box).map((stroke, index) =>
      line(index, path(stroke.points), one.dashed === true || stroke.dashed),
    );
  }
  return segmentsOf(one.values, extent, box).map((run, index) =>
    line(index, path(one.step ? stepped(run) : run), one.dashed === true),
  );
}

/** One line per account, on a shared scale: the Accounts page's 24-month comparison. */
export function MultiLine({
  series,
  summary,
  yLabels,
  xLabels,
  height = 180,
  hover,
  band,
}: {
  series: readonly Series[];
  summary: string;
  yLabels: readonly string[];
  xLabels: readonly string[];
  height?: number;
  hover?: readonly HoverPoint[];
  /** The gap between two series, shaded step by step: green above `lower`, red below it. */
  band?: Gap;
}) {
  const box: Box = { width: PLOT_WIDTH, height, pad: 6 };
  const extent = extentOf(series);
  return (
    <ChartFrame height={height} yLabels={yLabels} xLabels={xLabels} summary={summary} hover={hover}>
      <Plot height={height}>
        {band && <GapBand band={band} extent={extent} box={box} />}
        {series.map((one, index) => (
          <SeriesLine key={index} one={one} extent={extent} box={box} />
        ))}
      </Plot>
    </ChartFrame>
  );
}
