import {
  formatAmountInput,
  formatDate,
  type NumberFormat,
  type UiLocale,
} from "@ledgerly/domain/platform/format";
import type { ValuationRow } from "@ledgerly/domain/funds";
import type { DebitStatus } from "@ledgerly/domain/funds";
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

export { operationGross, operationOrigin, originParts, voluntaryCents } from "@ledgerly/domain/funds";
