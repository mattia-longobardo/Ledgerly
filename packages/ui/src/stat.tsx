import type { ReactNode } from "react";
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
  note,
  className,
}: {
  label: string;
  value: string;
  size?: "base" | "kpi";
  tone?: Tone;
  /** A line under the value: where it comes from. */
  note?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col", className)}>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className={cn("font-semibold tabular-nums", size === "kpi" && "text-kpi", tone && TONE_TEXT[tone])}>
        {value}
      </dd>
      {note && <dd className="text-xs text-faint">{note}</dd>}
    </div>
  );
}

/** The figures of a detail card side by side: two per row on a phone, `columns` past 3xl. */
export function StatGrid({ columns, children }: { columns: 3 | 5; children: ReactNode }) {
  return (
    <dl className={cn("grid grid-cols-2 gap-3", columns === 3 ? "@3xl:grid-cols-3" : "@3xl:grid-cols-5")}>
      {children}
    </dl>
  );
}
