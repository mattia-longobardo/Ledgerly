import type { ReactNode } from "react";
import { cn } from "./cn";

const TONE = {
  pos: "bg-pos-bg text-pos",
  warn: "bg-warn-bg text-warn",
  neg: "bg-neg-bg text-neg",
  accent: "bg-soft text-accent",
  neutral: "bg-hover text-muted",
} as const;

export function Badge({ tone, children }: { tone: keyof typeof TONE; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-sm px-1.5 py-0.5 text-xs font-medium", TONE[tone])}>
      {children}
    </span>
  );
}

/** A small label; `dashed` for what is written to elsewhere, beside what is read (PERS-615 §3). */
export function Tag({ children, dashed = false }: { children: ReactNode; dashed?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border border-border px-[5px] text-xs leading-4 text-muted",
        dashed && "border-dashed",
      )}
    >
      {children}
    </span>
  );
}
