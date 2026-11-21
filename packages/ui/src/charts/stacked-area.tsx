import type { HoverPoint } from "../chart-hover";
import { ChartFrame, Plot, PLOT_WIDTH, Strokes } from "./frame";
import { type Box, extentOf, strokesOf } from "./geometry";
import { bandPaths, stackLayers } from "./stack";

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
  /** Bottom first. `key`, when given, names the band for a `HighlightScope` around the chart. */
  layers: readonly { key?: string; label: string; color: string; values: readonly (number | null)[] }[];
  total: readonly (number | null)[];
  estimated?: readonly boolean[];
  summary: string;
  yLabels: readonly string[];
  xLabels: readonly string[];
  height?: number;
  hover?: readonly HoverPoint[];
}) {
  const box: Box = { width: PLOT_WIDTH, height, pad: 6 };
  const { bands, top, bottom } = stackLayers(
    layers.map((layer) => layer.values),
    total.length,
  );
  const extent = extentOf([{ values: top }, { values: bottom }, { values: total }]);
  return (
    <ChartFrame height={height} yLabels={yLabels} xLabels={xLabels} summary={summary} hover={hover}>
      <Plot height={height}>
        {bands.map((band, index) =>
          bandPaths(band, extent, box).map((shape, runIndex) => (
            <path
              key={`${index}-${runIndex}`}
              data-band={layers[index].label}
              data-series={layers[index].key}
              d={shape}
              fill={layers[index].color}
              fillOpacity={0.55}
              stroke={layers[index].color}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )),
        )}
        <Strokes strokes={strokesOf(total, estimated ?? [], extent, box)} color="var(--fg)" />
      </Plot>
    </ChartFrame>
  );
}
