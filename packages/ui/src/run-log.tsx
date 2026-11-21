// A log of runs (audit UI-INV-6): one line per run — when, its state in a badge, what it says — and
// its figure on the right. The readings of a service and the runs of a connection draw it the same;
// every word and figure is the caller's.
import type { ReactNode } from "react";
import { Badge } from "./badge";

export interface RunLogRow {
  key: string;
  when: ReactNode;
  state: { tone: Parameters<typeof Badge>[0]["tone"]; label: string };
  /** A line after the badge: a warning, counts. */
  note?: ReactNode;
  /** The run's figure, on the right. */
  value?: ReactNode;
}

export function RunLog({ rows, testId }: { rows: readonly RunLogRow[]; testId?: string }) {
  return (
    <ul className="flex flex-col">
      {rows.map((row) => (
        <li
          key={row.key}
          data-testid={testId}
          className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2 text-sm"
        >
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="text-muted">{row.when}</span>
            <Badge tone={row.state.tone}>{row.state.label}</Badge>
            {row.note}
          </span>
          {row.value !== undefined && <span className="font-medium tabular-nums">{row.value}</span>}
        </li>
      ))}
    </ul>
  );
}
