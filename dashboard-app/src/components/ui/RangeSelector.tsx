"use client";

import { useEffect, useState } from "react";
import { SegmentedControl, type SegmentedOption } from "./SegmentedControl";
import { Sheet } from "./Sheet";
import { cn } from "./cn";
import { formatMonthLong } from "@/lib/format";

export type RangeKey = "1M" | "3M" | "6M" | "12M" | "YTD" | "All";

/** Monthly granularity throughout — `YYYY-MM`, never a day. */
export interface MonthRange {
  from: string;
  to: string;
}

export interface RangeSelectorProps {
  value: RangeKey;
  custom?: MonthRange | null;
  onChange: (value: RangeKey | "custom", custom: MonthRange | null) => void;
  /** Clamp the pickers, e.g. the first month with data. */
  minMonth?: string;
  maxMonth?: string;
  className?: string;
}

const OPTIONS: readonly SegmentedOption<RangeKey>[] = [
  { value: "1M", label: "1M", srLabel: "1 month" },
  { value: "3M", label: "3M", srLabel: "3 months" },
  { value: "6M", label: "6M", srLabel: "6 months" },
  { value: "12M", label: "12M", srLabel: "12 months" },
  { value: "YTD", label: "YTD", srLabel: "Year to date" },
  { value: "All", label: "All", srLabel: "All history" },
];

function CalendarIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
    >
      <rect x={2.75} y={4.25} width={14.5} height={13} rx={2} />
      <path d="M2.75 8.25h14.5M6.5 2.75v3M13.5 2.75v3" />
    </svg>
  );
}

export function RangeSelector({
  value,
  custom = null,
  onChange,
  minMonth,
  maxMonth,
  className,
}: RangeSelectorProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [from, setFrom] = useState(custom?.from ?? "");
  const [to, setTo] = useState(custom?.to ?? "");

  useEffect(() => {
    setFrom(custom?.from ?? "");
    setTo(custom?.to ?? "");
  }, [custom?.from, custom?.to]);

  const valid = from !== "" && to !== "" && from <= to;
  const customActive = custom !== null;

  return (
    <div
      className={cn(
        "sticky top-0 z-20 flex items-center gap-2 bg-bg/95 px-4 py-2 backdrop-blur hairline-b",
        className,
      )}
    >
      <div className="-mx-1 min-w-0 flex-1 overflow-x-auto px-1">
        <SegmentedControl
          options={OPTIONS}
          value={value}
          onChange={(next) => onChange(next, null)}
          label="Time range"
          variant="pill"
        />
      </div>
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        aria-haspopup="dialog"
        aria-label="Choose a custom month range"
        className={cn(
          "inline-flex size-11 shrink-0 items-center justify-center rounded-md border transition-colors duration-150 ease-out",
          customActive
            ? "border-accent bg-accent text-accent-contrast"
            : "border-border bg-surface text-fg-muted",
        )}
      >
        <CalendarIcon />
      </button>

      <Sheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="Custom range"
        description="Pick a first and last month. History is monthly, so there is no day picker."
        height="auto"
        footer={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                onChange(value, null);
                setSheetOpen(false);
              }}
              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-md border border-border bg-surface px-4 text-body-sm font-medium text-fg"
            >
              Clear
            </button>
            <button
              type="button"
              disabled={!valid}
              onClick={() => {
                onChange("custom", { from, to });
                setSheetOpen(false);
              }}
              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast disabled:opacity-40"
            >
              Apply
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-caption tracking-wide text-fg-muted uppercase">From</span>
            <input
              type="month"
              value={from}
              min={minMonth}
              max={maxMonth}
              onChange={(event) => setFrom(event.target.value)}
              className="num min-h-11 rounded-md border border-border bg-surface px-3 text-body text-fg"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-caption tracking-wide text-fg-muted uppercase">To</span>
            <input
              type="month"
              value={to}
              min={from === "" ? minMonth : from}
              max={maxMonth}
              onChange={(event) => setTo(event.target.value)}
              className="num min-h-11 rounded-md border border-border bg-surface px-3 text-body text-fg"
            />
          </label>
          <p aria-live="polite" className="text-body-sm text-fg-muted">
            {valid
              ? `${formatMonthLong(`${from}-01`)} — ${formatMonthLong(`${to}-01`)}`
              : "Choose two months to apply a custom range."}
          </p>
        </div>
      </Sheet>
    </div>
  );
}
