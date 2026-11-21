import type { ReactNode } from "react";
import { Card } from "@ledgerly/ui/card";
import { cn } from "@ledgerly/ui/cn";
import type { timeoff } from "@ledgerly/api-contract/timeoff";
import type { RouteOutput } from "@ledgerly/api-client";

type MonthBar = RouteOutput<typeof timeoff.getTimeOff>["bars"][number];

/**
 * One of the two headline cards of the design: how much is left, a bar split between taken and
 * planned, and — below it — where the number came from.
 *
 * The provenance line is not decoration. §7.9 makes the residual come from either the last
 * payslip or the stated allowance, and the two can disagree; a card that showed only the number
 * would leave the person no way to tell which of the two they are looking at.
 */
export function KindCard({
  label,
  allowanceNote,
  value,
  valueUnit,
  takenNote,
  plannedNote,
  basisNote,
  accrualNotes = [],
  takenShare,
  plannedShare,
  tone,
  testId,
}: {
  label: string;
  /** "26 days / year", or an empty string when nobody has stated an allowance. */
  allowanceNote: string;
  /** The residual, already formatted, or the "—" of an unknown one. */
  value: string;
  valueUnit: string;
  takenNote: string;
  plannedNote: string | null;
  /** Where the residual came from, in the user's own words. */
  basisNote: string;
  /** What a month grants and what the year will hand on, one line each (N5.1); none when unknown. */
  accrualNotes?: string[];
  /** 0–1 of the bar each part fills; they are clamped so the two together never exceed it. */
  takenShare: number;
  plannedShare: number;
  tone: "primary" | "warn";
  testId: string;
}) {
  const taken = clamp(takenShare);
  const planned = clamp(Math.min(plannedShare, 1 - taken));
  return (
    <YearCard label={label} aside={allowanceNote || null} value={value} unit={valueUnit} testId={testId}>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-track">
        <div
          className={cn("h-full", tone === "warn" ? "bg-warn" : "bg-primary")}
          style={{ width: `${taken * 100}%` }}
        />
        <div className="h-full bg-accent opacity-45" style={{ width: `${planned * 100}%` }} />
      </div>
      <div className="flex flex-wrap gap-x-3 text-sm text-muted tabular-nums">
        <span>{takenNote}</span>
        {plannedNote && <span>{plannedNote}</span>}
      </div>
      {accrualNotes.length > 0 && (
        <ul
          className="flex flex-col gap-0.5 text-sm text-muted tabular-nums"
          data-testid={`${testId}-accrual`}
        >
          {accrualNotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      <p className="text-xs text-faint">{basisNote}</p>
    </YearCard>
  );
}

/**
 * What every card of the year's figures shares (audit UI-TOF-3): a label with a note beside it, the
 * figure in large type with its unit, and below them whatever the card has to say — the slot.
 */
export function YearCard({
  label,
  aside,
  value,
  unit,
  testId,
  children,
}: {
  label: string;
  /** Beside the label, on the right: "26 days / year", or nothing. */
  aside: string | null;
  value: string;
  unit: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <Card className="flex min-w-0 flex-col gap-2.5" data-testid={testId}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-muted">{label}</span>
        {aside !== null && <span className="text-sm text-muted tabular-nums">{aside}</span>}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-kpi font-semibold tracking-title tabular-nums">{value}</span>
        <span className="text-muted">{unit}</span>
      </div>
      {children}
    </Card>
  );
}

function clamp(value: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;
}

/**
 * The design's "By month": twelve bars, each stacked taken-over-planned, scaled to the busiest
 * month so a quiet year is still readable. All twelve are always drawn — a month with nothing in
 * it is a gap in the chart, not a missing bar.
 */
export function MonthBars({
  bars,
  shortNames,
  labelFor,
}: {
  bars: MonthBar[];
  shortNames: string[];
  labelFor: (bar: MonthBar) => string;
}) {
  const peak = Math.max(1, ...bars.map((bar) => bar.takenMinutes + bar.plannedMinutes));
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="grid h-11 grid-cols-12 items-end gap-1">
        {bars.map((bar) => (
          <div
            key={bar.month}
            title={labelFor(bar)}
            className="flex min-h-[2px] flex-col justify-end overflow-hidden rounded-xs"
            style={{ height: `${((bar.takenMinutes + bar.plannedMinutes) / peak) * 100}%` }}
          >
            <div
              className="bg-accent opacity-45"
              style={{ flexBasis: `${share(bar.plannedMinutes, bar)}%` }}
            />
            <div
              className="bg-primary opacity-85"
              style={{ flexBasis: `${share(bar.takenMinutes, bar)}%` }}
            />
          </div>
        ))}
      </div>
      {/* 10 px, as the design has it: at twelve columns in a quarter-width card, 12 px labels
          run into each other. */}
      <div className="grid grid-cols-12 text-center text-micro text-faint">
        {shortNames.map((name, index) => (
          <span key={index}>{name}</span>
        ))}
      </div>
    </div>
  );
}

function share(part: number, bar: MonthBar): number {
  const total = bar.takenMinutes + bar.plannedMinutes;
  return total === 0 ? 0 : (part / total) * 100;
}
