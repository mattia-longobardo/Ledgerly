"use client";

import { formatMonthLong, formatNumber } from "@/lib/format";
import { cn } from "./cn";

/**
 * `taken` = already used (a past day); `planned` = booked but still ahead
 * ("previsto"). Drawn as filled vs outlined so the difference survives
 * greyscale and colour-blindness — colour is never the only signal.
 */
export type MonthGridTone = "taken" | "planned";

interface MonthGridDayBase {
  /** `full` = a whole day; `half` = a half day, drawn half-filled. */
  kind: "full" | "half";
  tone?: MonthGridTone;
  /** Only for sources that count in hours (payslip ROL); omit for a calendar. */
  hours?: number;
  note?: string;
}

/**
 * A day is addressed by ISO date, or — for callers that already know the month
 * from the `month` prop — by day-of-month. Both are accepted because the dev
 * preview harness still passes plain day numbers and is owned elsewhere; ISO is
 * the form real callers should use, since it is what an editor handler needs.
 */
export type MonthGridDay =
  | (MonthGridDayBase & { date: string; day?: never })
  | (MonthGridDayBase & { day: number; date?: never });

export interface MonthGridProps {
  /** `YYYY-MM`. */
  month: string;
  days: readonly MonthGridDay[];
  defaultExpanded?: boolean;
  /**
   * Makes the expanded body an editable grid of day buttons instead of a plain
   * list. Receives the ISO date of the day tapped — including empty days, so a
   * new one can be booked.
   */
  onSelectDay?: (isoDate: string) => void;
  /** Greys out days the caller cannot accept (e.g. weekends on a blocked plan). */
  isDaySelectable?: (isoDate: string) => boolean;
  className?: string;
}

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"] as const;

function monthMeta(month: string): { year: number; index: number; length: number; offset: number } {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1;
  const length = new Date(Date.UTC(year, index + 1, 0)).getUTCDate();
  // Monday-first grid.
  const offset = (new Date(Date.UTC(year, index, 1)).getUTCDay() + 6) % 7;
  return { year, index, length, offset };
}

function dayNumber(d: MonthGridDay): number {
  return d.date !== undefined ? Number(d.date.slice(8, 10)) : d.day;
}

function isoOf(month: string, day: number): string {
  return `${month}-${String(day).padStart(2, "0")}`;
}

/** Fractions are the calendar's unit: a half day is 0.5 of one. */
function fractionOf(d: MonthGridDay): number {
  return d.kind === "half" ? 0.5 : 1;
}

type DotKind = "full" | "half" | "none";

function Dot({ kind, tone = "taken" }: { kind: DotKind; tone?: MonthGridTone }) {
  if (kind === "none") {
    return <span aria-hidden className="size-2.5 rounded-full border border-border" />;
  }
  // Planned days are hollow, taken days are solid — the same distinction the
  // legend states in words.
  if (kind === "full") {
    return (
      <span
        aria-hidden
        className={cn(
          "size-2.5 rounded-full",
          tone === "planned" ? "border border-accent bg-accent/25" : "bg-accent",
        )}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="size-2.5 overflow-hidden rounded-full border border-accent"
    >
      <span className={cn("block h-full w-1/2", tone === "planned" ? "bg-accent/40" : "bg-accent")} />
    </span>
  );
}

function summaryOf(days: readonly MonthGridDay[]): string {
  if (days.length === 0) return "nothing taken";

  // Hour-denominated sources (the payslip's ROL) keep their own wording; a
  // calendar has no hours and is summarised in days.
  const hasHours = days.some((d) => d.hours !== undefined);
  if (hasHours) {
    const fullCount = days.filter((d) => d.kind === "full").length;
    const halfDays = days.filter((d) => d.kind === "half");
    const halfHours = halfDays.reduce((sum, d) => sum + (d.hours ?? 0), 0);
    return [
      fullCount > 0 ? `${formatNumber(fullCount)} d taken` : null,
      halfDays.length > 0 ? `${formatNumber(halfHours)} h ROL` : null,
    ]
      .filter((s): s is string => s !== null)
      .join(" · ");
  }

  const taken = days
    .filter((d) => d.tone !== "planned")
    .reduce((sum, d) => sum + fractionOf(d), 0);
  const planned = days
    .filter((d) => d.tone === "planned")
    .reduce((sum, d) => sum + fractionOf(d), 0);

  return [
    taken > 0 ? `${formatNumber(taken)} d taken` : null,
    planned > 0 ? `${formatNumber(planned)} d planned` : null,
  ]
    .filter((s): s is string => s !== null)
    .join(" · ");
}

function describeDay(d: MonthGridDay): string {
  if (d.note !== undefined) return d.note;
  if (d.hours !== undefined && d.kind === "half") return `ROL ${formatNumber(d.hours)} h`;
  const unit = d.kind === "full" ? "Full day" : "Half day";
  return d.tone === "planned" ? `${unit} · planned` : unit;
}

/**
 * One month as a dot grid. Native `<details>` so a 12-month vertical list needs
 * no client JS and each header is already a real disclosure button.
 *
 * The dot grid inside `<summary>` stays decorative even when the month is
 * editable: a button nested in a summary would fight the disclosure for the
 * same tap. The editable grid lives in the body, where a tap means only one
 * thing.
 */
export function MonthGrid({
  month,
  days,
  defaultExpanded,
  onSelectDay,
  isDaySelectable,
  className,
}: MonthGridProps) {
  const { year, index, length, offset } = monthMeta(month);
  const byDay = new Map<number, MonthGridDay>();
  for (const d of days) byDay.set(dayNumber(d), d);

  const summary = summaryOf(days);
  const editable = onSelectDay !== undefined;

  return (
    <details className={cn("group hairline-b", className)} open={defaultExpanded}>
      <summary className="cursor-pointer list-none px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="flex min-h-11 items-center gap-3">
          <span className="min-w-0 flex-1">
            <span className="block text-body text-fg">{formatMonthLong(`${month}-01`)}</span>
            <span className="num block text-caption text-fg-muted">{summary}</span>
          </span>
          <svg
            aria-hidden
            viewBox="0 0 20 20"
            width={16}
            height={16}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 text-fg-muted transition-transform duration-150 ease-out group-open:rotate-90"
          >
            <path d="M7.5 4.5 13 10l-5.5 5.5" />
          </svg>
        </span>

        <span aria-hidden className="mt-2 grid grid-cols-7 gap-y-1">
          {WEEKDAYS.map((letter, i) => (
            <span key={i} className="num text-center text-caption text-fg-muted">
              {letter}
            </span>
          ))}
          {Array.from({ length: offset }, (_, i) => (
            <span key={`pad-${i}`} />
          ))}
          {Array.from({ length }, (_, i) => {
            const entry = byDay.get(i + 1);
            return (
              <span key={i} className="flex h-4 items-center justify-center">
                <Dot kind={entry?.kind ?? "none"} {...(entry?.tone ? { tone: entry.tone } : {})} />
              </span>
            );
          })}
        </span>
      </summary>

      <div className="px-4 pb-3">
        {editable ? (
          <div className="grid grid-cols-7 gap-0.5">
            {WEEKDAYS.map((letter, i) => (
              <span key={`h-${i}`} className="num pb-1 text-center text-caption text-fg-muted">
                {letter}
              </span>
            ))}
            {Array.from({ length: offset }, (_, i) => (
              <span key={`pad-${i}`} />
            ))}
            {Array.from({ length }, (_, i) => {
              const day = i + 1;
              const iso = isoOf(month, day);
              const entry = byDay.get(day);
              const selectable = isDaySelectable?.(iso) ?? true;
              return (
                <button
                  key={day}
                  type="button"
                  disabled={!selectable}
                  onClick={() => onSelectDay(iso)}
                  aria-label={`${day} ${formatMonthLong(`${month}-01`)}${entry ? ` — ${describeDay(entry)}` : " — no leave"}`}
                  className={cn(
                    "flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-xs border",
                    entry === undefined
                      ? "border-transparent bg-surface"
                      : "border-border bg-surface-raised",
                    selectable ? "text-fg" : "cursor-not-allowed text-fg-muted opacity-40",
                  )}
                >
                  <span className="num text-caption leading-none">{day}</span>
                  <Dot
                    kind={entry?.kind ?? "none"}
                    {...(entry?.tone ? { tone: entry.tone } : {})}
                  />
                </button>
              );
            })}
          </div>
        ) : days.length === 0 ? (
          <p className="text-body-sm text-fg-muted">No days taken this month.</p>
        ) : (
          <ul className="flex flex-col">
            {[...days]
              .sort((a, b) => dayNumber(a) - dayNumber(b))
              .map((d) => (
                <li
                  key={dayNumber(d)}
                  className="flex min-h-11 items-center justify-between gap-3 hairline-t"
                >
                  <span className="num text-body-sm text-fg">
                    {String(dayNumber(d)).padStart(2, "0")}/{String(index + 1).padStart(2, "0")}/
                    {year}
                  </span>
                  <span className="text-body-sm text-fg-muted">{describeDay(d)}</span>
                </li>
              ))}
          </ul>
        )}
      </div>
    </details>
  );
}
