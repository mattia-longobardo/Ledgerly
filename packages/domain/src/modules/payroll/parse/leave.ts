import { type LeaveKind, leaveField } from "../fields";
import type { PayslipType, ProfileBalance } from "../rules";
import { UNCONFIRMED_LEAVE } from "../rules/legacy";
import type { Warning } from "./checks";
import { hundredthsOf, type Values } from "./derive";
import type { RawLine } from "./read";

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

/** The hours of a line, when it counts them (a quantity in days is not hours). */
function hoursOf(line: RawLine): number | null {
  const quantity = line.quantity === null ? null : Number(line.quantity);
  return quantity !== null && Number.isFinite(quantity) && quantity > 0 && line.quantityUnit !== "days" ? quantity : null;
}

/**
 * The leave taken, from the body (owner's spec L163–182, spec §7.8): only the lines with a
 * balance's `eventRole` count — the absence twin of each is the other side of the same entry. A
 * balance with `confirmBy` is the first of those balances that confirms the use (L170): what the
 * previous payslip left, plus what accrued since, minus these hours, must be its remaining now;
 * none confirming leaves the use unconfirmed, under its own balance. A 13th carries no leave of its
 * own (L173, L244).
 */
export function leaveEvents(
  input: { type: PayslipType; period: string | null; lines: readonly RawLine[]; values: Values },
  previous: PreviousPayslip | null,
  balances: readonly ProfileBalance[],
): { events: LeaveEventDraft[]; warnings: Warning[] } {
  const { type, period, lines, values } = input;
  const counted = balances.flatMap((balance) => {
    const own = lines.filter((line) => balance.eventRole !== undefined && line.role === balance.eventRole);
    return own.length > 0 ? [{ balance, own }] : [];
  });
  if (type !== "ordinary" || period === null) {
    return { events: [], warnings: counted.length > 0 ? [{ code: "extra_month_leave" }] : [] };
  }
  const warnings: Warning[] = [];
  const events: LeaveEventDraft[] = [];
  for (const { balance, own } of counted) {
    let kind: LeaveKind = balance.kind;
    if (balance.confirmBy) {
      const total = own.reduce((sum, line) => sum + (hoursOf(line) ?? 0), 0);
      if (total <= 0) continue;
      const confirmed = confirmedBy(values, previous, period, total, balance.confirmBy);
      if (confirmed === null) warnings.push({ code: UNCONFIRMED_LEAVE, detail: { hours: total.toFixed(2) } });
      kind = confirmed ?? balance.kind;
    }
    for (const line of own) {
      const hours = hoursOf(line);
      if (hours !== null) events.push({ kind, hours: hours.toFixed(2), linePositions: [line.position] });
    }
  }
  return { events, warnings };
}

/** The first of `kinds` whose balance moved by `hours` since the previous payslip, or `null`. */
function confirmedBy(
  values: Values,
  previous: PreviousPayslip | null,
  period: string,
  hours: number,
  kinds: readonly LeaveKind[],
): LeaveKind | null {
  if (!previous) return null;
  const sameYear = previous.period.slice(0, 4) === period.slice(0, 4);
  const used = BigInt(Math.round(hours * 100));
  for (const kind of kinds) {
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
