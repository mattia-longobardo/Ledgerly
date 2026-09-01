import { formatAsOf, formatRelativeAge } from "@/lib/format";
import { cn } from "./cn";

export interface StaleBadgeProps {
  capturedAt: Date | null | undefined;
  stale?: boolean;
  /** Relative age ("14 min ago") instead of the absolute stamp. */
  compact?: boolean;
  className?: string;
}

export function StaleBadge({ capturedAt, stale = false, compact = false, className }: StaleBadgeProps) {
  const absolute = formatAsOf(capturedAt);
  const text = compact ? formatRelativeAge(capturedAt) : `as of ${absolute}`;

  return (
    <span
      className={cn(
        "num inline-flex items-center gap-1 text-caption whitespace-nowrap",
        stale
          ? "rounded-xs bg-warning/10 px-1.5 py-0.5 text-warning"
          : "text-fg-muted",
        className,
      )}
    >
      {stale && (
        <span aria-hidden className="font-sans font-semibold">
          !
        </span>
      )}
      {/* Relative ages differ between the server render and the client clock. */}
      <time
        dateTime={capturedAt ? capturedAt.toISOString() : undefined}
        title={absolute}
        suppressHydrationWarning
      >
        {text}
      </time>
      {stale && <span className="sr-only">(may be out of date)</span>}
    </span>
  );
}
