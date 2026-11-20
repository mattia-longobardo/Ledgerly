import { cn } from "./cn";
import { type Tone, TONE_TEXT } from "./tone";

/**
 * One figure with its label (audit UI-DS-5), inside a `<dl>`: the term, then its value. `kpi` is the
 * size of a summary's figures; the value may carry the tone of its sign.
 */
export function Stat({
  label,
  value,
  size = "base",
  tone,
  className,
}: {
  label: string;
  value: string;
  size?: "base" | "kpi";
  tone?: Tone;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col", className)}>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className={cn("font-semibold tabular-nums", size === "kpi" && "text-kpi", tone && TONE_TEXT[tone])}>
        {value}
      </dd>
    </div>
  );
}
