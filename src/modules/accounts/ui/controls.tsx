import type { Route } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/ui/cn";

export type Params = Record<string, string | undefined>;

/** The page's own address with some parameters changed; an empty value drops the parameter. */
export function withParams(path: string, current: Params, changes: Params): Route {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...current, ...changes })) {
    if (value !== undefined && value !== "") query.set(key, value);
  }
  const search = query.toString();
  return (search ? `${path}?${search}` : path) as Route;
}

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
  options: readonly { value: string; label: string }[];
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
  periodLabel: string;
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
        <span aria-label={nextLabel} aria-disabled className={cn(arrow, "text-faint")}>
          <ChevronRight aria-hidden className="size-3.5" />
        </span>
      ) : (
        <Link href={step(offset - 1)} aria-label={nextLabel} className={cn(arrow, "hover:bg-hover")}>
          <ChevronRight aria-hidden className="size-3.5" />
        </Link>
      )}
      {!atLatest && (
        <Link
          href={step(0)}
          className="focus-ring rounded-[2px] text-sm font-medium text-accent hover:underline"
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
