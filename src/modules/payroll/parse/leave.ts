import { centsToDecimal } from "@/platform/money";
import { type LeaveKind, leaveField } from "../fields";
import type { PayslipType } from "../rules";
import type { Warning } from "./checks";
import { hundredthsOf, type Values } from "./derive";
import type { RawLine } from "./reply-teamsystem";

/** A leave event before it is stored: hours as a decimal string, and the lines it comes from. */
export interface LeaveEventDraft {
  kind: LeaveKind;
  hours: string;
  /** Positions of the body lines, so the stored event can point at them (spec §6). */
  linePositions: number[];
}

/** The payslip before this one (same employer and employee, the month before), as it stands. */
export interface PreviousPayslip {
  period: string;
  values: Values;
}

/**
 * The leave taken, from the body (owner's spec L163–182, spec §7.8): only the FERIE (301) and
 * PERMESSI (309) lines count — their ASSENZA twins (300, 308) are the other side of the same entry.
 * A permit is ROL only when the ROL balance confirms it (L170): what the previous payslip left,
 * plus what accrued since, minus these hours, must be the ROL remaining now. A 13th carries no
 * leave of its own (L173, L244).
 */
export function leaveEvents(
  type: PayslipType,
  period: string | null,
  lines: readonly RawLine[],
  values: Values,
  previous: PreviousPayslip | null,
): { events: LeaveEventDraft[]; warnings: Warning[] } {
  const vacation = lines.filter((line) => line.role === "vacation_event");
  const permits = lines.filter((line) => line.role === "permit_event");
  if (type !== "ordinary" || period === null) {
    return {
      events: [],
      warnings: vacation.length + permits.length > 0 ? [{ code: "extra_month_leave" }] : [],
    };
  }
  const warnings: Warning[] = [];
  const hoursOf = (line: RawLine) => {
    const quantity = line.quantity === null ? null : Number(line.quantity);
    return quantity !== null && Number.isFinite(quantity) && quantity > 0 && line.quantityUnit !== "days"
      ? quantity
      : null;
  };
  const events: LeaveEventDraft[] = [];
  for (const line of vacation) {
    const hours = hoursOf(line);
    if (hours !== null) events.push({ kind: "vacation", hours: hours.toFixed(2), linePositions: [line.position] });
  }
  const permitHours = permits.reduce((sum, line) => sum + (hoursOf(line) ?? 0), 0);
  if (permitHours > 0) {
    const kind = confirmedBy(values, previous, period, permitHours);
    if (kind === null) warnings.push({ code: "permit_unclassified", detail: { hours: permitHours.toFixed(2) } });
    for (const line of permits) {
      const hours = hoursOf(line);
      if (hours !== null) events.push({ kind: kind ?? "permit", hours: hours.toFixed(2), linePositions: [line.position] });
    }
  }
  return { events, warnings };
}

/** The balance (ROL first, then permits) whose movement matches `hours`, or `null`. */
function confirmedBy(
  values: Values,
  previous: PreviousPayslip | null,
  period: string,
  hours: number,
): "rol" | "permit" | null {
  if (!previous) return null;
  const sameYear = previous.period.slice(0, 4) === period.slice(0, 4);
  const used = BigInt(Math.round(hours * 100));
  for (const kind of ["rol", "permit"] as const) {
    const before = hundredthsOf(previous.values, leaveField(kind, "Remaining"));
    const accruedBefore = sameYear ? (hundredthsOf(previous.values, leaveField(kind, "Accrued")) ?? 0n) : 0n;
    const accruedNow = hundredthsOf(values, leaveField(kind, "Accrued"));
    const now = hundredthsOf(values, leaveField(kind, "Remaining"));
    if (before === null || accruedNow === null || now === null) continue;
    const expected = before + (accruedNow - accruedBefore) - used;
    const difference = expected > now ? expected - now : now - expected;
    if (difference <= 1n) return kind;
  }
  return null;
}

/** Hours summed from drafts, as a decimal string. */
export function totalHours(events: readonly LeaveEventDraft[], kind: LeaveKind): string {
  return centsToDecimal(events.filter((event) => event.kind === kind).reduce((sum, event) => sum + BigInt(Math.round(Number(event.hours) * 100)), 0n));
}
