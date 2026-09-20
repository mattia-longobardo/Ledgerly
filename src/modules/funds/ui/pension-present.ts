import { formatDate, formatMoney, type NumberFormat, NULL_DISPLAY, type UiLocale } from "@/platform/format";
import type { Cents } from "@/platform/money";
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

/** An amount, or "—" with no pretence that an unknown is a zero (spec §8.4.7). */
export function amountOrDash(cents: Cents | null, format: NumberFormat): string {
  return cents === null ? NULL_DISPLAY : formatMoney(cents, format);
}

/** A date as the person reads dates, or "—". */
export function dateOrDash(on: string | null, locale: UiLocale): string {
  return on === null ? NULL_DISPLAY : formatDate(on, "long", locale);
}

/** The two Cometa documents the fund is fed from (spec §9.3, GC §8.4): nothing else is imported. */
export const COMETA_KINDS = ["cometa_operations", "cometa_position"] as const;
export type CometaKind = (typeof COMETA_KINDS)[number];

/** A document the fund still needs; `awaiting` when one is already uploaded and not yet applied. */
export interface MissingImport {
  kind: CometaKind;
  awaiting: boolean;
}

/** A document that is neither applied nor out of the way is still on its way to the fund. */
const IN_PROGRESS = (state: string) => state !== "applied" && state !== "rejected" && state !== "failed";

/**
 * Which of the two Cometa documents the fund is still missing, in the order they are asked for:
 * the operations export (no operation imported) then the position summary (no statement). Both
 * present — the ordinary case — gives an empty list, and the guidance disappears with it.
 */
export function missingImports({
  operations,
  snapshots,
  documents,
}: {
  operations: number;
  snapshots: number;
  documents: readonly { kind: string; state: string }[];
}): MissingImport[] {
  const awaiting = (kind: CometaKind) =>
    documents.some((document) => document.kind === kind && IN_PROGRESS(document.state));
  const missing: MissingImport[] = [];
  if (operations === 0) missing.push({ kind: "cometa_operations", awaiting: awaiting("cometa_operations") });
  if (snapshots === 0) missing.push({ kind: "cometa_position", awaiting: awaiting("cometa_position") });
  return missing;
}

/** The quantities a missing import leaves unknown: never a mute "—" (spec §8.4.7). */
export type BlockedKpi = "value" | "paidIn";

const KPI_NEEDS: Record<BlockedKpi, CometaKind> = {
  value: "cometa_position",
  paidIn: "cometa_operations",
};

/** The document a quantity waits for, or `null` when it is computable and only the data is empty. */
export function kpiBlockedBy(kpi: BlockedKpi, missing: readonly MissingImport[]): CometaKind | null {
  const kind = KPI_NEEDS[kpi];
  return missing.some((one) => one.kind === kind) ? kind : null;
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
