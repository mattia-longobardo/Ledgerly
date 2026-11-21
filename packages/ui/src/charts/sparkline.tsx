import { cn } from "../cn";
import { type Box, extentOf, path, segmentsOf } from "./geometry";

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
