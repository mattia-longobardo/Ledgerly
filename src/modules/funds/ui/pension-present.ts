import type { Status } from "../pension/reconcile";

/** How each reconciliation state reads (design, GC §11): a colour never carries it alone. */
export const STATUS_TONE: Record<Status, "pos" | "neg" | "warn" | "accent" | "neutral"> = {
  reconciled: "pos",
  invested: "pos",
  // Nothing accused it and nothing confirmed it: the schedule says it left, which is a settled
  // state, not a warning.
  transferred: "pos",
  present: "accent",
  accrued_not_due: "neutral",
  to_verify: "warn",
  incomplete: "warn",
  discrepancy: "neg",
};

/** "II 2026" — the quarter as the fund's own documents write it. */
export function quarterLabel(year: number, quarter: number): string {
  return `${["I", "II", "III", "IV"][quarter - 1]} ${year}`;
}

/** How the versioned schedule reads in Settings (design "Employer transfers"): never a field. */
export interface TransferRhythm {
  frequency: "quarterly" | "monthly" | "custom";
  /** The day of the month after the period, when every deadline shares one; `null` otherwise. */
  day: number | null;
}

export function transferRhythm(
  schedule: readonly { quarter: number; month: number; day: number; nextYear: boolean }[],
): TransferRhythm {
  const days = [...new Set(schedule.map((entry) => entry.day))];
  return {
    frequency: schedule.length === 4 ? "quarterly" : schedule.length === 12 ? "monthly" : "custom",
    day: days.length === 1 ? days[0] : null,
  };
}
