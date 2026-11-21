import type { HoverPoint } from "../chart-hover";
import { ChartFrame, Plot, PLOT_WIDTH, Strokes } from "./frame";
import { areaPath, type Box, extentOf, segmentsOf, strokesOf } from "./geometry";

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
  const box: Box = { width: PLOT_WIDTH, height, pad: 6 };
  const extent = extentOf([{ values }]);
  const runs = segmentsOf(values, extent, box);
  const floor = box.height - box.pad;
  return (
    <ChartFrame height={height} yLabels={yLabels} xLabels={xLabels} summary={summary} hover={hover}>
      <Plot height={height}>
        {runs.map((run, index) =>
          run.length > 1 ? (
            <path key={index} d={areaPath(run, floor)} fill="var(--soft)" opacity={0.6} />
          ) : null,
        )}
        <Strokes strokes={strokesOf(values, estimated ?? [], extent, box)} color="var(--accent)" />
      </Plot>
    </ChartFrame>
  );
}
