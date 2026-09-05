import Link from "next/link";
import { formatMonth } from "@/lib/format";
import { placeInQueue, reviewHref, type QueueEntry } from "./queue";

export interface QueueNavProps {
  /** Every payslip still waiting for a decision, current one included. */
  pending: readonly QueueEntry[];
  currentId: string;
}

function monthText(entry: QueueEntry): string {
  return entry.isThirteenth ? `${formatMonth(entry.month)} · 13ª` : formatMonth(entry.month);
}

/**
 * Plain links, so browsing the run costs nothing and never touches a payslip:
 * the decision buttons stay the only thing that writes.
 */
function Step({ entry, direction }: { entry: QueueEntry | null; direction: "prev" | "next" }) {
  const arrow = direction === "prev" ? "‹" : "›";

  if (entry === null) {
    return (
      <span
        aria-hidden
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-3 text-body-sm text-fg-muted opacity-40"
      >
        {arrow}
      </span>
    );
  }

  return (
    <Link
      href={reviewHref(entry.id)}
      aria-label={`${direction === "prev" ? "Previous" : "Next"} payslip in the queue: ${monthText(entry)}`}
      className="inline-flex min-h-11 min-w-11 max-w-[40%] items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-3 text-body-sm text-fg"
    >
      {direction === "prev" && <span aria-hidden>{arrow}</span>}
      {/* The month is a hint, not the target: it is dropped before it can wrap. */}
      <span className="hidden truncate sm:inline">{monthText(entry)}</span>
      {direction === "next" && <span aria-hidden>{arrow}</span>}
    </Link>
  );
}

export function QueueNav({ pending, currentId }: QueueNavProps) {
  const { position, total, prev, next } = placeInQueue(pending, currentId);
  if (total === 0) return null;

  return (
    <nav
      aria-label="Verification queue"
      className="flex items-center justify-between gap-2 px-4 py-2 hairline-b lg:px-0"
    >
      <Step entry={prev} direction="prev" />
      <span className="min-w-0 truncate text-center text-caption tracking-wide text-fg-muted uppercase">
        {position === null ? (
          <>
            <span className="num">{total}</span> still to verify
          </>
        ) : (
          <>
            <span className="num">
              {position} of {total}
            </span>{" "}
            to verify
          </>
        )}
      </span>
      <Step entry={next} direction="next" />
    </nav>
  );
}
