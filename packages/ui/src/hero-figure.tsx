import type { ReactNode } from "react";
import { cn } from "./cn";
import { type Tone, TONE_TEXT } from "./tone";

/**
 * The large figure at the head of a detail page (audit UI-PCK-2, UI-DS-5): what it is, the figure,
 * what it means, and on the right a second figure it is measured against.
 */
export function HeroFigure({
  caption,
  value,
  tone,
  note,
  aside,
}: {
  caption: ReactNode;
  value: string;
  tone?: Tone;
  note?: ReactNode;
  aside?: { label: string; value: string };
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm text-muted">{caption}</p>
        <p className={cn("text-hero font-semibold tracking-title tabular-nums", tone && TONE_TEXT[tone])}>
          {value}
        </p>
        {note && <p className="text-sm text-muted">{note}</p>}
      </div>
      {aside && (
        <div className="flex flex-col items-end gap-0.5 text-right">
          <span className="text-sm text-muted">{aside.label}</span>
          <span className="text-lg font-semibold tabular-nums">{aside.value}</span>
        </div>
      )}
    </div>
  );
}
