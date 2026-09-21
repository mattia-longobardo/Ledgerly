import Link from "next/link";
import type { ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/ui/cn";
import { type Params, withParams } from "@/ui/url";

// Moved to `src/ui/url.ts` in F2.5 so the date range picker in `src/ui` can build addresses too;
// re-exported here because every screen of F1 and F2 already imports them from this file.
export { type Params, withParams };

/**
 * The design's segmented switches (range, span, chart mode, grain) as links rather than state: the
 * choice lives in the URL, so the server renders it and the control works before any JavaScript
 * has run (spec §8.4, every static control of the prototype works).
 */
export function LinkTabs({
  label,
  path,
  params,
  name,
  current,
  options,
}: {
  label: string;
  path: string;
  params: Params;
  name: string;
  current: string;
  /** `count`, when given, is shown after the label the way the filter chips show theirs. */
  options: readonly { value: string; label: string; count?: number }[];
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex gap-0.5 rounded-[7px] bg-hover p-0.5">
      {options.map((option) => (
        <Link
          key={option.value}
          href={withParams(path, params, { [name]: option.value })}
          aria-current={option.value === current ? "true" : undefined}
          className={cn(
            "focus-ring inline-flex h-6 items-center rounded-[5px] px-2.5 text-sm font-medium",
            option.value === current
              ? "bg-card text-fg shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
              : "text-muted hover:text-fg",
          )}
        >
          {option.label}
          {option.count !== undefined && (
            <span className="ml-1.5 text-micro text-muted tabular-nums">{option.count}</span>
          )}
        </Link>
      ))}
    </div>
  );
}

/**
 * Previous · period · next · Latest. "Next" is disabled on the period still running, so the
 * control can never walk into the future.
 */
export function PeriodStepper({
  label,
  path,
  params,
  offset,
  periodLabel,
  previousLabel,
  nextLabel,
  latestLabel,
}: {
  label: string;
  path: string;
  params: Params;
  offset: number;
  /** Text, or the control that opens a date picker: in the design the period label is the button. */
  periodLabel: ReactNode;
  previousLabel: string;
  nextLabel: string;
  latestLabel: string;
}) {
  const step = (to: number) => withParams(path, params, { off: to === 0 ? "" : String(to) });
  const atLatest = offset <= 0;
  const arrow = "focus-ring grid size-7 place-items-center rounded-ctl border border-border bg-card";

  return (
    <div role="group" aria-label={label} className="inline-flex items-center gap-2">
      <Link href={step(offset + 1)} aria-label={previousLabel} className={cn(arrow, "hover:bg-hover")}>
        <ChevronLeft aria-hidden className="size-3.5" />
      </Link>
      <span className="min-w-[150px] text-center text-sm font-medium">{periodLabel}</span>
      {atLatest ? (
        // A disabled control, not a decorated span: `aria-label` on a span with no role is
        // prohibited (WCAG 4.1.2), and a screen reader would read it as nothing at all.
        <button type="button" disabled aria-label={nextLabel} className={cn(arrow, "text-faint")}>
          <ChevronRight aria-hidden className="size-3.5" />
        </button>
      ) : (
        <Link href={step(offset - 1)} aria-label={nextLabel} className={cn(arrow, "hover:bg-hover")}>
          <ChevronRight aria-hidden className="size-3.5" />
        </Link>
      )}
      {!atLatest && (
        <Link
          href={step(0)}
          className="focus-ring inline-flex min-h-6 items-center rounded-[2px] text-sm font-medium text-accent hover:underline"
        >
          {latestLabel}
        </Link>
      )}
    </div>
  );
}

export type RangeKey = "3m" | "1y" | "all";

const RANGE_MONTHS: Record<RangeKey, number> = { "3m": 3, "1y": 12, all: 120 };

export const RANGE_OPTIONS: readonly { value: RangeKey; label: string }[] = [
  { value: "3m", label: "3M" },
  { value: "1y", label: "1Y" },
  { value: "all", label: "All" },
];

export function rangeMonths(range: RangeKey | undefined): number {
  return RANGE_MONTHS[range ?? "1y"] ?? RANGE_MONTHS["1y"];
}

/** The account chart's spans, from the design: 3M · 6M · 1Y · 2Y · YTD. */
export type SpanKey = "3m" | "6m" | "1y" | "2y" | "ytd";

export const SPAN_OPTIONS: readonly { value: SpanKey; label: string }[] = [
  { value: "3m", label: "3M" },
  { value: "6m", label: "6M" },
  { value: "1y", label: "1Y" },
  { value: "2y", label: "2Y" },
  { value: "ytd", label: "YTD" },
];

/** How many months a span covers; YTD counts January of the current year to now. */
export function spanMonths(span: SpanKey | undefined, month: number): number {
  switch (span) {
    case "3m":
      return 3;
    case "6m":
      return 6;
    case "2y":
      return 24;
    case "ytd":
      return month;
    default:
      return 12;
  }
}

/**
 * A checkbox that is really a link, the shape the Expenses filter bar already uses: a server
 * component cannot hold state, so the query string is the state and the glyph draws it.
 */
export function ToggleLink({
  label,
  path,
  params,
  name,
  on,
}: {
  label: string;
  path: string;
  params: Params;
  /** The query parameter it turns on and off; `"1"` means on. */
  name: string;
  on: boolean;
}) {
  return (
    <Link
      href={withParams(path, params, { [name]: on ? "" : "1" })}
      aria-current={on ? "true" : undefined}
      className={cn(
        "focus-ring inline-flex h-[30px] items-center gap-1.5 rounded-ctl border bg-card px-2.5 text-sm font-medium hover:bg-hover",
        on ? "border-accent" : "border-border",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "grid size-3.5 shrink-0 place-items-center rounded-[4px] border",
          on ? "border-primary bg-primary text-primary-fg" : "border-border2",
        )}
      >
        {on && <Check className="size-2.5" />}
      </span>
      {label}
    </Link>
  );
}
