import type { PayslipType } from "../rules";
import { type CheckResult, type HistoryPoint, runChecks, type Warning } from "./checks";
import { type Derived, deriveFields, type Values } from "./derive";
import { type LeaveEventDraft, leaveEvents, type PreviousPayslip } from "./leave";
import type { RawLine } from "./reply-teamsystem";

export interface Assembled {
  /** Every field's value as it stands, derived ones included. */
  values: Values;
  derived: Derived;
  checks: CheckResult[];
  events: LeaveEventDraft[];
  warnings: Warning[];
}

/**
 * Layers 2 and 3 of the owner's spec (L254) on the fields as they stand: derived values, checks,
 * leave events. Run after a reading and again after every correction, so nothing is ever stale.
 */
export function assemble(input: {
  type: PayslipType;
  period: string | null;
  values: Values;
  lines: readonly RawLine[];
  previous: PreviousPayslip | null;
  history: readonly HistoryPoint[];
}): Assembled {
  const derived = deriveFields(input.values, input.type);
  const values: Values = { ...input.values, ...derived.values };
  const checks = runChecks({
    type: input.type,
    period: input.period,
    values,
    lines: input.lines,
    history: input.history,
  });
  const leave = leaveEvents(input.type, input.period, input.lines, values, input.previous);
  return { values, derived, checks, events: leave.events, warnings: [...derived.warnings, ...leave.warnings] };
}
