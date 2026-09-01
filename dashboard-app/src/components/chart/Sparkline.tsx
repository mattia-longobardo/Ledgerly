import { cn } from "../ui/cn";

export type SparkTone = "accent" | "positive" | "negative" | "muted";

export interface SparklineProps {
  values: readonly (number | null)[];
  width?: number;
  height?: number;
  tone?: SparkTone;
  area?: boolean;
  className?: string;
}

const TONE_CLASS: Record<SparkTone, string> = {
  accent: "text-accent",
  positive: "text-positive",
  negative: "text-negative",
  muted: "text-fg-muted",
};

/**
 * No axes, no interaction, no uPlot — a row-sized SVG glance that stays on the
 * server so an account list costs zero client JS.
 */
export function Sparkline({
  values,
  width = 64,
  height = 24,
  tone = "accent",
  area = false,
  className,
}: SparklineProps) {
  const finite = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (finite.length < 2) {
    return (
      <svg
        aria-hidden
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        className={cn("shrink-0", TONE_CLASS.muted, className)}
      >
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="currentColor"
          strokeWidth={1}
          strokeDasharray="2 3"
          opacity={0.6}
        />
      </svg>
    );
  }

  let min = Infinity;
  let max = -Infinity;
  for (const v of finite) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min || 1;
  const pad = 1.5;
  const stepX = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;

  const point = (v: number, i: number): [number, number] => [
    pad + i * stepX,
    pad + (1 - (v - min) / span) * (height - pad * 2),
  ];

  // Null gaps break the line into separate segments rather than being bridged.
  const segments: string[] = [];
  let current: string[] = [];
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) {
      if (current.length > 1) segments.push(current.join(" "));
      current = [];
      return;
    }
    const [x, y] = point(v, i);
    current.push(`${current.length === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`);
  });
  if (current.length > 1) segments.push(current.join(" "));

  const first = values.findIndex((v) => v !== null && Number.isFinite(v));
  let last = -1;
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const v = values[i];
    if (v !== null && v !== undefined && Number.isFinite(v)) {
      last = i;
      break;
    }
  }
  const areaPath =
    area && segments.length === 1 && first >= 0 && last >= 0
      ? `${segments[0]} L${(pad + last * stepX).toFixed(2)},${height} L${(pad + first * stepX).toFixed(2)},${height} Z`
      : null;

  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      preserveAspectRatio="none"
      className={cn("shrink-0", TONE_CLASS[tone], className)}
    >
      {areaPath !== null && <path d={areaPath} fill="currentColor" opacity={0.08} />}
      {segments.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth={1}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
