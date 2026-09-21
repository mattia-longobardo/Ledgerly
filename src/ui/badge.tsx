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
    <span
      className={cn("inline-flex items-center rounded-[4px] px-1.5 py-0.5 text-xs font-medium", TONE[tone])}
    >
      {children}
    </span>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-[4px] border border-border px-[5px] text-xs leading-4 text-muted">
      {children}
    </span>
  );
}
