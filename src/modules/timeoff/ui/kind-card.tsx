import { Card } from "@/ui/card";
import { cn } from "@/ui/cn";
import type { MonthBar } from "../rules";

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
  /** 0–1 of the bar each part fills; they are clamped so the two together never exceed it. */
  takenShare: number;
  plannedShare: number;
  tone: "primary" | "warn";
  testId: string;
}) {
  const taken = clamp(takenShare);
  const planned = clamp(Math.min(plannedShare, 1 - taken));
  return (
    <Card className="flex min-w-0 flex-col gap-2.5" data-testid={testId}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-muted">{label}</span>
        {allowanceNote && <span className="text-sm text-muted tabular-nums">{allowanceNote}</span>}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-kpi font-semibold tracking-[-0.02em] tabular-nums">{value}</span>
        <span className="text-muted">{valueUnit}</span>
      </div>
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
      <p className="text-xs text-faint">{basisNote}</p>
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
            className="flex min-h-[2px] flex-col justify-end overflow-hidden rounded-[2px]"
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
      <div className="grid grid-cols-12 text-center text-[10px] text-faint">
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
