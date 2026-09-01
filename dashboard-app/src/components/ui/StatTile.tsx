import type { ReactNode } from "react";
import { cn } from "./cn";

export interface StatTileProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  delta?: ReactNode;
  className?: string;
}

/** Flat by construction: one hairline border, one background step, no shadow. */
export function StatTile({ label, value, sub, delta, className }: StatTileProps) {
  return (
    <div className={cn("flex flex-col gap-1 rounded-md border border-border bg-surface p-4", className)}>
      <span className="text-caption tracking-wide text-fg-muted uppercase">{label}</span>
      <span className="num text-display-sm leading-tight text-fg">{value}</span>
      {(sub !== undefined || delta !== undefined) && (
        <span className="mt-1 flex flex-wrap items-center gap-2">
          {delta}
          {sub !== undefined && <span className="text-body-sm text-fg-muted">{sub}</span>}
        </span>
      )}
    </div>
  );
}
