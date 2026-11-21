import type { HoverPoint } from "../chart-hover";
import { ChartFrame, Plot, PLOT_WIDTH } from "./frame";

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
  hover,
}: {
  values: readonly (number | null)[];
  summary: string;
  yLabels: readonly string[];
  xLabels: readonly string[];
  height?: number;
  hover?: readonly HoverPoint[];
}) {
  const known = values.filter((value): value is number => value !== null);
  const reach = Math.max(1, ...known.map(Math.abs));
  const zero = height / 2;
  const slot = PLOT_WIDTH / Math.max(1, values.length);
  const barWidth = Math.max(2, slot * 0.6);
  return (
    <ChartFrame
      height={height}
      yLabels={yLabels}
      xLabels={xLabels}
      summary={summary}
      hover={hover}
      slots
      grid={false}
    >
      <Plot height={height} className="h-full w-full">
        <line x1={0} x2={PLOT_WIDTH} y1={zero} y2={zero} stroke="var(--border)" strokeWidth={1} />
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
      </Plot>
    </ChartFrame>
  );
}
