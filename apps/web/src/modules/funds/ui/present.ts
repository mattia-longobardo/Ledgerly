import { formatAmountInput, formatDate, type NumberFormat, type UiLocale } from "@ledgerly/format/format";
import { parseCents } from "@ledgerly/format/cents";
import type { DebitStatus } from "@ledgerly/domain/funds";
import type { ValuationDraft } from "./fund-forms";

/** A recorded valuation of `/api/v1` as the "Edit" dialog starts from it. */
export function valuationDraft(
  row: { id: string; on: string; value: string; note: string | null },
  format: NumberFormat,
): ValuationDraft {
  return {
    id: row.id,
    on: row.on,
    value: formatAmountInput(parseCents(row.value), format),
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

/** The state of a recurring debit of `/api/v1` (`status`, `on`, `by`): text and tone. */
export function wireMonthPill(
  debit: { status: "found" | "awaited" | "missing" | "none"; on: string | null },
  locale: UiLocale,
  labels: Parameters<typeof monthPill>[2],
): { text: string; tone: "pos" | "neg" | "muted" } {
  if (debit.status === "found")
    return { text: labels.found(formatDate(debit.on, "dayMonth", locale)), tone: "pos" };
  if (debit.status === "awaited") return { text: labels.awaited, tone: "muted" };
  if (debit.status === "missing") return { text: labels.missing, tone: "neg" };
  return { text: labels.none, tone: "muted" };
}
