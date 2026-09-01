import { formatDelta, formatPercent, type Money } from "@/lib/format";
import { cn } from "./cn";

export interface DeltaBadgeProps {
  value: Money;
  percent?: number | null;
  /** Spoken context, e.g. "vs last month". Not rendered. */
  context?: string;
  className?: string;
}

type Tone = "positive" | "negative" | "neutral";

const TONE_CLASS: Record<Tone, string> = {
  positive: "text-positive bg-positive/10",
  negative: "text-negative bg-negative/10",
  neutral: "text-fg-muted bg-surface-raised border border-border",
};

const TONE_WORD: Record<Tone, string> = {
  positive: "up",
  negative: "down",
  neutral: "unchanged",
};

function toneOf(value: Money): Tone {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n === 0) return "neutral";
  return n > 0 ? "positive" : "negative";
}

/** The +/− glyph carries the sign, so colour is never the only signal. */
export function DeltaBadge({ value, percent, context, className }: DeltaBadgeProps) {
  const tone = toneOf(value);
  const amount = formatDelta(value);
  const pct = percent === undefined || percent === null ? null : formatPercent(percent, { signed: true });

  return (
    <span
      className={cn(
        "num inline-flex items-center gap-1.5 rounded-xs px-1.5 py-0.5 text-body-sm whitespace-nowrap",
        TONE_CLASS[tone],
        className,
      )}
      aria-label={[TONE_WORD[tone], amount, pct, context].filter(Boolean).join(" ")}
    >
      <span aria-hidden>{amount}</span>
      {pct !== null && (
        <span aria-hidden className="text-fg-muted">
          {pct}
        </span>
      )}
    </span>
  );
}
