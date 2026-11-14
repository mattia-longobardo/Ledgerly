import { formatAmountInput, formatDate, type NumberFormat, type UiLocale } from "@/platform/format";
import type { Cents } from "@/platform/money";
import type { MoneyOrigin } from "../period";
import type { ValuationRow } from "../pension/operations";
import type { DebitStatus, SourceKind } from "../sources";
import type { ValuationDraft } from "./fund-forms";

/** A recorded valuation as the "Edit" dialog starts from it. */
export function valuationDraft(row: ValuationRow, format: NumberFormat): ValuationDraft {
  return {
    id: row.id,
    on: row.on,
    value: formatAmountInput(row.valueCents, format),
    note: row.note ?? "",
  };
}

/** The state of a recurring debit's running period: text and tone. */
export function monthPill(
  status: DebitStatus,
  locale: UiLocale,
  labels: { found: (date: string) => string; awaited: string; missing: string; none: string },
): { text: string; tone: "pos" | "neg" | "muted" } {
  switch (status.kind) {
    case "found":
      return { text: labels.found(formatDate(status.on, "dayMonth", locale)), tone: "pos" };
    case "awaited":
      return { text: labels.awaited, tone: "muted" };
    case "missing":
      return { text: labels.missing, tone: "neg" };
    case "none":
      return { text: labels.none, tone: "muted" };
  }
}

/** Where a line of the register came from, as its badge says it. */
export type OperationOrigin = "payroll" | "rule" | "manual" | "import";

const ORIGIN_OF_KIND: Record<SourceKind, OperationOrigin> = {
  payroll: "payroll",
  bank_debit: "rule",
  manual: "manual",
};

/**
 * The origin of an operation: the kind of the source it belongs to, when it has one — a payslip
 * contribution written by hand belongs to the payslip source —, otherwise who wrote it.
 */
export function operationOrigin(
  operation: { source: OperationOrigin | string; sourceId: string | null },
  sources: readonly { id: string; kind: SourceKind }[],
): OperationOrigin {
  const source = operation.sourceId === null ? null : sources.find((one) => one.id === operation.sourceId);
  if (source) return ORIGIN_OF_KIND[source.kind];
  return operation.source === "import" ? "import" : operation.source === "rule" ? "rule" : "manual";
}

interface Amounts {
  classification: string;
  workerCents: Cents;
  employerCents: Cents;
  tfrCents: Cents;
  otherCents: Cents;
}

/** What an operation moved across the fund's boundary, gross: an exit is money out, so it is negative. */
export function operationGross(operation: Amounts): Cents {
  const gross = operation.workerCents + operation.employerCents + operation.tfrCents + operation.otherCents;
  return operation.classification === "withdrawal" && gross > 0n ? -gross : gross;
}

/** What the voluntary contributions of some operations add up to: the part of "you" paid outside the payslip. */
export function voluntaryCents(operations: readonly Amounts[]): Cents {
  return operations
    .filter((operation) => operation.classification === "voluntary")
    .reduce<Cents>((sum, operation) => sum + operation.workerCents, 0n);
}

export type OriginPart = "you" | "employer" | "tfr" | "voluntary" | "other";

/**
 * Of whom the money is, one part per line and the empty ones left out. The voluntary payments are
 * taken out of "you": they are yours, and they did not come from the payslip.
 */
export function originParts(origin: MoneyOrigin, voluntary: Cents): { key: OriginPart; cents: Cents }[] {
  const parts: { key: OriginPart; cents: Cents }[] = [
    { key: "you", cents: origin.youCents - voluntary },
    { key: "employer", cents: origin.employerCents },
    { key: "tfr", cents: origin.tfrCents },
    { key: "voluntary", cents: voluntary },
    { key: "other", cents: origin.otherCents },
  ];
  return parts.filter((part) => part.cents !== 0n);
}
