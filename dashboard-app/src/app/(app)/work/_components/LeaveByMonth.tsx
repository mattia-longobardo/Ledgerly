import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/components/ui/cn";
import type { LeaveTakenMonth } from "@/lib/calc/payroll";
import { formatDays, formatMonth, formatNumber } from "@/lib/format";

export interface LeaveByMonthProps {
  months: readonly LeaveTakenMonth[];
  /** Days used so far this year, for the summary line above the list. */
  ytdDays: number;
  year: number;
  /** First payslip still waiting on the human gate, so the empty state can link to it. */
  firstPendingId: number | null;
  pendingCount: number;
}

/**
 * Leave used, one row per month, read off the verified payslips. Read-only by
 * nature rather than by omission: these are payroll's figures, and the editable
 * day list — the leave calendar rendered just above — is the other side of the
 * comparison, not a duplicate of this one.
 *
 * Deliberately not a day grid: the payslip reports a monthly total in hours and
 * never says *which* days, so drawing dated dots would invent detail the source
 * does not carry. The calendar above is where days live.
 */
export function LeaveByMonth({
  months,
  ytdDays,
  year,
  firstPendingId,
  pendingCount,
}: LeaveByMonthProps) {
  // A verified payslip reporting 0 h still produces a row; only rows with real
  // hours mean "leave was actually used".
  const hasUsage = months.some((m) => m.totalHours > 0);
  const peak = months.reduce((max, m) => Math.max(max, m.totalDays), 0);

  return (
    <section className="mt-8">
      <div className="flex min-h-11 items-center gap-3 px-4">
        <h2 className="min-w-0 flex-1 text-caption tracking-wide text-fg-muted uppercase">
          Ferie e ROL used
        </h2>
        {hasUsage && (
          <span className="num shrink-0 text-body-sm text-fg-muted">
            {formatDays(ytdDays)} in {year}
          </span>
        )}
      </div>

      {!hasUsage ? (
        <div className="px-4 pt-2">
          <EmptyState
            title="Nothing used yet"
            description={
              pendingCount > 0
                ? `Used days are read off the payslips, never entered by hand — they appear here once ${pendingCount === 1 ? "the payslip waiting for you is" : `the ${pendingCount} payslips waiting for you are`} verified.`
                : "Used days are read off the payslips, never entered by hand. Nothing shows here until a verified payslip reports ferie or ROL hours."
            }
            action={
              firstPendingId === null ? undefined : (
                <Link
                  href={`/work/verify/${firstPendingId}`}
                  className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast"
                >
                  Verify a payslip
                </Link>
              )
            }
          />
        </div>
      ) : (
        <>
          <p className="px-4 pb-2 text-body-sm text-fg-muted">
            Monthly totals from the verified payslips. The payslip states hours, not dates.
          </p>
          <ul className="hairline-t">
            {months.map((m) => (
              <li key={m.month} className="hairline-b px-4 py-3">
                <div className="flex min-h-11 flex-col justify-center gap-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="num min-w-0 flex-1 truncate text-body text-fg">
                      {formatMonth(m.month)}
                    </span>
                    <span
                      className={cn(
                        "num shrink-0 text-body",
                        m.totalHours > 0 ? "text-fg" : "text-fg-muted",
                      )}
                    >
                      {formatDays(m.totalDays)}
                    </span>
                  </div>

                  {/* Relative weight across the year — a bar, not a dot grid,
                      because the source is an hours total with no dates. */}
                  <div aria-hidden className="h-1 rounded-xs bg-border">
                    <div
                      className="h-1 rounded-xs bg-accent"
                      style={{ width: `${peak > 0 ? (m.totalDays / peak) * 100 : 0}%` }}
                    />
                  </div>

                  <span className="num text-caption text-fg-muted">
                    {`Ferie ${formatNumber(m.ferieHours)} h · ROL ${formatNumber(m.rolHours)} h`}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
