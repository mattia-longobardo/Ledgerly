// A state as a badge (audit UI-PAY-4): each area declares once which tone each of its states has,
// and every place that shows the state reads that one map.
import type { ReactNode } from "react";
import { Badge } from "./badge";

export type StatusTone = "pos" | "warn" | "neg" | "accent" | "neutral";

export function StatusBadge<S extends string>({
  status,
  tones,
  children,
}: {
  status: S;
  tones: Readonly<Record<S, StatusTone>>;
  /** The state's words. */
  children: ReactNode;
}) {
  return <Badge tone={tones[status]}>{children}</Badge>;
}
