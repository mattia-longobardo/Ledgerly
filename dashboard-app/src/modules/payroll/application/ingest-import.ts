import type { Confidence, PayslipExtraction } from "@/lib/contracts";
import type { PayslipHistoryEntry } from "@/lib/payroll/confidence";
import { PARSER_VERSION, parsePayslip } from "@/lib/payroll/parse";
import type { Principal } from "@/platform/auth/principal";
import { textSourceColumn } from "../domain/payroll";
import type { PayrollImport, UseCaseDeps } from "./ports";

export type IngestOutcome =
  | { outcome: "parsed"; import: PayrollImport }
  | { outcome: "needs_ocr"; import: PayrollImport }
  | { outcome: "rejected_infected"; import: PayrollImport }
  | { outcome: "scanner_unavailable"; import: PayrollImport }
  | { outcome: "skipped"; reason: "not_scanning" | "no_bytes" };

/**
 * Ports the orchestrator (`infrastructure/ingest.ts`) injects for testing, so
 * the suite never loads `unpdf` or touches the network. Kept here, not in the
 * orchestrator, because `ParseConclusion.parsed` is shaped by whatever
 * `parse`'s return type is.
 */
export interface IngestPorts {
  /** Injected in tests so the suite never loads `unpdf`. Defaults to the existing extractor. */
  extractText?(bytes: Uint8Array): Promise<string | null>;
  /** Injected in tests so the suite never touches the network. Defaults to the existing parser. */
  parse?: typeof parsePayslip;
  /** Prior verified payslips, for the parser's continuity and median checks. Defaults to none. */
  history?(): Promise<readonly PayslipHistoryEntry[]>;
}

// ---------------------------------------------------------------------------
// Scanning — split into a read-only "begin" half and a write-only "apply"
// half (PH4-C7). The orchestrator in `infrastructure/ingest.ts` sandwiches
// the actual `documents.get`/`scanner.scan` network calls, and the
// `documents.delete` for an infected verdict, strictly *between* two short,
// separately-committed transactions built around these two functions — so no
// I/O ever runs while a transaction is open (Ruling R4-8 applied to the scan
// boundary that Ruling R4-2 requires).
// ---------------------------------------------------------------------------

export type ScanReadiness = { ready: true; storageKey: string } | { ready: false; outcome: IngestOutcome };

/**
 * Read-only half. Confirms the import is actually waiting to be scanned and
 * hands back the storage key the orchestrator needs to fetch the bytes.
 * No I/O of its own — this may run inside a transaction that closes the
 * instant it returns.
 */
export function beginScan(deps: UseCaseDeps) {
  return async (principal: Principal, importId: string): Promise<ScanReadiness> => {
    const found = await deps.imports.get(principal.userId, importId);
    if (!found || found.status !== "scanning" || found.storageKey === null) {
      return { ready: false, outcome: { outcome: "skipped", reason: "not_scanning" } };
    }
    return { ready: true, storageKey: found.storageKey };
  };
}

export type ScanConclusion =
  | { kind: "bytes_missing" }
  | { kind: "infected"; scanner: string; signature: string | null }
  | { kind: "unavailable"; scanner: string }
  | { kind: "clean"; scanner: string };

/**
 * Write-only half. Applies a scan conclusion the orchestrator has already
 * computed — bytes fetched, `scanner.scan` awaited, and, for `infected`, the
 * object already deleted from the store. No I/O of its own.
 *
 * The three verdicts fail in three different directions on purpose:
 * `infected` is terminal — a retry finds `beginScan` refusing (the import is
 * no longer `scanning`) and re-rejects without reading anything new;
 * `unavailable` leaves the row exactly where it was so the next job tick
 * retries; `clean` is the only one that opens the gate to the parser. An
 * import can therefore reach `extracting` in exactly one way, and
 * `readOriginal` (Task 13) leans on the same `scan_status = 'clean'` fact.
 */
export function applyScanConclusion(deps: UseCaseDeps) {
  return async (principal: Principal, importId: string, conclusion: ScanConclusion): Promise<IngestOutcome> => {
    const scannedAt = deps.clock.now();

    if (conclusion.kind === "bytes_missing") {
      await deps.imports.patch(principal.userId, importId, { status: "failed", error: "bytes_missing", storageKey: null });
      return { outcome: "skipped", reason: "no_bytes" };
    }

    if (conclusion.kind === "infected") {
      // The orchestrator deletes the bytes *before* calling this — delete
      // first, then record. A crash between the two leaves an orphan row
      // pointing at bytes that are gone, which the retention job tolerates;
      // the reverse order would leave real malware in the bucket with
      // nothing recording that it is there.
      const updated = await deps.imports.patch(principal.userId, importId, {
        status: "rejected",
        scanStatus: "infected",
        scanner: conclusion.scanner,
        scanSignature: conclusion.signature,
        scannedAt,
        error: "scan_infected",
        storageKey: null,
      });
      await deps.audit({
        actorUserId: principal.userId,
        action: "payroll.import_rejected",
        entityType: "payroll_import",
        entityId: importId,
        after: { reason: "scan_infected", scanner: conclusion.scanner, signature: conclusion.signature },
      });
      return { outcome: "rejected_infected", import: updated! };
    }

    if (conclusion.kind === "unavailable") {
      const updated = await deps.imports.patch(principal.userId, importId, {
        status: "scanning",
        scanStatus: "unavailable",
        scanner: conclusion.scanner,
        scannedAt,
        error: "scan_unavailable",
      });
      return { outcome: "scanner_unavailable", import: updated! };
    }

    const updated = await deps.imports.patch(principal.userId, importId, {
      status: "extracting",
      scanStatus: "clean",
      scanner: conclusion.scanner,
      scanSignature: null,
      scannedAt,
      error: null,
    });
    return { outcome: "parsed", import: updated! };
  };
}

// ---------------------------------------------------------------------------
// Parsing — the same read-only/write-only split. The orchestrator sandwiches
// `documents.get`, `extractText` and `parse` (which itself calls the LLM via
// `llmOptionsFromConfig`) between the two.
// ---------------------------------------------------------------------------

export type ParseReadiness =
  | { ready: true; storageKey: string; fileName: string }
  | { ready: false; outcome: IngestOutcome };

/**
 * Read-only half. Refuses to hand back anything unless the scanner has
 * cleared the import (Ruling R4-2's enforcement point) and it is sitting in
 * `extracting` or `needs_ocr`. No I/O of its own.
 */
export function beginParse(deps: UseCaseDeps) {
  return async (principal: Principal, importId: string): Promise<ParseReadiness> => {
    const found = await deps.imports.get(principal.userId, importId);
    if (!found || found.scanStatus !== "clean") {
      return { ready: false, outcome: { outcome: "skipped", reason: "not_scanning" } };
    }
    if (found.status !== "extracting" && found.status !== "needs_ocr") {
      return { ready: false, outcome: { outcome: "skipped", reason: "not_scanning" } };
    }
    if (found.storageKey === null) {
      return { ready: false, outcome: { outcome: "skipped", reason: "no_bytes" } };
    }
    return { ready: true, storageKey: found.storageKey, fileName: found.fileName };
  };
}

export type ParseConclusion =
  | { kind: "bytes_missing" }
  | { kind: "no_text_layer" }
  | { kind: "parsed"; extraction: PayslipExtraction };

function confidenceMap(extraction: PayslipExtraction): Record<string, Confidence> {
  const out: Record<string, Confidence> = {};
  for (const [field, value] of Object.entries(extraction.fields)) {
    if (value) out[field] = value.confidence;
  }
  return out;
}

/**
 * Write-only half. `extraction` has already been produced by
 * `extractPdfText`/`parsePayslip` outside any transaction; this only records
 * the outcome. A PDF with no usable text layer parks in `needs_ocr` (Ruling
 * R4-9) rather than ever reaching this function with an empty-string
 * extraction — the exact "invented financial data" failure that ruling
 * exists to avoid. No I/O of its own.
 */
export function applyParseConclusion(deps: UseCaseDeps) {
  return async (principal: Principal, importId: string, conclusion: ParseConclusion): Promise<IngestOutcome> => {
    if (conclusion.kind === "bytes_missing") {
      await deps.imports.patch(principal.userId, importId, { status: "failed", error: "bytes_missing", storageKey: null });
      return { outcome: "skipped", reason: "no_bytes" };
    }

    if (conclusion.kind === "no_text_layer") {
      const updated = await deps.imports.patch(principal.userId, importId, {
        status: "needs_ocr",
        textSource: textSourceColumn(null),
        error: "no_text_layer",
      });
      return { outcome: "needs_ocr", import: updated! };
    }

    const extraction = conclusion.extraction;
    const updated = await deps.imports.patch(principal.userId, importId, {
      status: "needs_review",
      textSource: textSourceColumn("pdf"),
      parserVersion: extraction.parserVersion || PARSER_VERSION,
      extraction,
      confidence: confidenceMap(extraction),
      error: null,
    });
    // Counts, never amounts: an audit row must not become a second copy of the
    // payslip (global constraint).
    await deps.audit({
      actorUserId: principal.userId,
      action: "payroll.import_parsed",
      entityType: "payroll_import",
      entityId: importId,
      after: {
        textSource: textSourceColumn("pdf"),
        parserVersion: extraction.parserVersion || PARSER_VERSION,
        fieldsRead: Object.values(extraction.fields).filter((f) => f && f.value !== null).length,
      },
    });
    return { outcome: "parsed", import: updated! };
  };
}
