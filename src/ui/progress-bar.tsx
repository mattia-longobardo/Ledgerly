import { cn } from "./cn";

const FILL = { accent: "bg-accent", warn: "bg-warn", neg: "bg-neg", pos: "bg-pos" } as const;
const HEIGHT = { 4: "h-1", 6: "h-1.5", 8: "h-2" } as const;

export function ProgressBar({
  value,
  label,
  tone = "accent",
  height = 6,
  dashed = false,
}: {
  value: number;
  label: string;
  tone?: keyof typeof FILL;
  height?: keyof typeof HEIGHT;
  /** A striped track and no fill: something with no end to measure against (spec §8.3). */
  dashed?: boolean;
}) {
  const percent = Math.round(Math.min(Math.max(value, 0), 1) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={cn("w-full overflow-hidden rounded-full bg-track", HEIGHT[height])}
      style={
        dashed
          ? {
              backgroundImage: "repeating-linear-gradient(90deg, var(--border2) 0 6px, transparent 6px 10px)",
            }
          : undefined
      }
    >
      {!dashed && <div className={cn("h-full rounded-full", FILL[tone])} style={{ width: `${percent}%` }} />}
    </div>
  );
}
