import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/components/ui/cn";
import type { SyncRun } from "@/platform/integrations/types";

const RUN_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Rome",
});

const TONE: Record<string, string> = {
  queued: "text-fg-muted",
  running: "text-fg-muted",
  success: "text-positive",
  failed: "text-negative",
  skipped: "text-fg-muted",
};

function duration(run: SyncRun): string {
  if (!run.finishedAt) return "—";
  const ms = run.finishedAt.getTime() - run.startedAt.getTime();
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function SyncRunsTable({ runs }: { runs: readonly SyncRun[] }) {
  if (runs.length === 0) {
    return (
      <EmptyState
        title="No syncs yet"
        description="Press Sync now, or wait for the scheduled run."
      />
    );
  }

  return (
    <ul className="hairline-t">
      {runs.map((run) => (
        <li key={run.id} className="flex min-h-11 items-start gap-3 py-2 hairline-b">
          <span className="min-w-0 flex-1">
            <span className="num block text-body-sm text-fg">
              {RUN_TIME.format(run.startedAt)} · {run.kind} · {run.trigger}
            </span>
            <span className="num block truncate text-caption text-fg-muted">
              {Object.entries(run.stats)
                .map(([key, value]) => `${key}: ${value}`)
                .join(" · ") || "no changes"}
            </span>
            {run.error !== null && (
              <span title={run.error} className="block truncate text-caption text-negative">
                {run.error}
              </span>
            )}
          </span>
          <span className="shrink-0 text-right">
            <span className={cn("num block text-caption", TONE[run.status] ?? "text-fg-muted")}>
              {run.status}
            </span>
            <span className="num block text-caption text-fg-muted">{duration(run)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
