import type { TextSource } from "@/lib/payroll/text";
import type { PayrollImportStatus, TextSourceColumn } from "../application/ports";

/**
 * The three statuses at which nothing more will happen to an import. Only
 * these are purgeable by the retention job (Ruling R4-5), which is what makes
 * "a document still being worked on is out of reach" true by construction
 * rather than by the job remembering to check.
 */
export const TERMINAL_STATUSES = ["applied", "rejected", "superseded"] as const satisfies readonly PayrollImportStatus[];

export const LIVE_STATUSES = [
  "received", "scanning", "needs_ocr", "extracting", "parsed", "needs_review", "verified", "failed",
] as const satisfies readonly PayrollImportStatus[];

/** Ruling R4-6: values are editable up to the apply, and never after it. */
export const EDITABLE_STATUSES = ["needs_review", "verified"] as const satisfies readonly PayrollImportStatus[];

export function isTerminal(status: PayrollImportStatus): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

export function isEditable(status: PayrollImportStatus): boolean {
  return (EDITABLE_STATUSES as readonly string[]).includes(status);
}

/**
 * The whole pipeline in one table, so no use case has to reason about
 * reachability on its own. Read it as "from → the set it may move to".
 *
 * `scanning → scanning` is deliberate: an `unavailable` verdict leaves the row
 * where it is for the next tick (Ruling R4-2), and a transition check that
 * rejected the self-loop would turn a retry into a spurious failure.
 * `failed → received` is the reuse path for an upload whose bytes never landed
 * (Ruling R4-3).
 */
const TRANSITIONS: Record<PayrollImportStatus, readonly PayrollImportStatus[]> = {
  received: ["scanning", "rejected", "failed"],
  scanning: ["scanning", "extracting", "rejected", "failed"],
  extracting: ["parsed", "needs_ocr", "rejected", "failed"],
  needs_ocr: ["extracting", "rejected", "failed"],
  parsed: ["needs_review", "rejected", "failed"],
  needs_review: ["needs_review", "verified", "rejected", "failed"],
  verified: ["needs_review", "verified", "applied", "rejected", "failed"],
  applied: ["superseded"],
  rejected: [],
  superseded: [],
  failed: ["received", "scanning", "rejected"],
};

export function canTransition(from: PayrollImportStatus, to: PayrollImportStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Ruling R4-14. The parser's `TextSource` has two values; the column has the
 * spec's three. `null` — meaning no text was ever obtained — becomes `none`,
 * which is exactly the `needs_ocr` state and is never confused with an OCR pass
 * that returned an empty string.
 */
export function textSourceColumn(source: TextSource | null): TextSourceColumn {
  if (source === "pdf") return "pdf_text";
  if (source === "ocr") return "ocr";
  return "none";
}
