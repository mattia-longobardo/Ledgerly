import type { Confidence } from "@/lib/contracts";
import type { PayslipHistoryEntry } from "@/lib/payroll/confidence";
import { llmOptionsFromConfig } from "@/lib/payroll/llm-config";
import { PARSER_VERSION, parsePayslip } from "@/lib/payroll/parse";
import { extractPdfText } from "@/lib/payroll/text";
import type { Principal } from "@/platform/auth/principal";
import { textSourceColumn } from "../domain/payroll";
import { titleIsThirteenth, titleMonth } from "../domain/period";
import type { PayrollImport, UseCaseDeps } from "./ports";

export type IngestOutcome =
  | { outcome: "parsed"; import: PayrollImport }
  | { outcome: "needs_ocr"; import: PayrollImport }
  | { outcome: "rejected_infected"; import: PayrollImport }
  | { outcome: "scanner_unavailable"; import: PayrollImport }
  | { outcome: "skipped"; reason: "not_scanning" | "no_bytes" };

export interface IngestPorts {
  /** Injected in tests so the suite never loads `unpdf`. Defaults to the existing extractor. */
  extractText?(bytes: Uint8Array): Promise<string | null>;
  /** Injected in tests so the suite never touches the network. Defaults to the existing parser. */
  parse?: typeof parsePayslip;
  /** Prior verified payslips, for the parser's continuity and median checks. Defaults to none. */
  history?(): Promise<readonly PayslipHistoryEntry[]>;
}

/**
 * The scanning boundary (Ruling R4-2), written as read → I/O → write so the
 * clamd round trip never sits inside a transaction.
 *
 * The three verdicts fail in three different directions on purpose:
 * `infected` deletes the bytes and is terminal; `unavailable` keeps everything
 * and leaves the row where it is so the next tick retries; `clean` is the only
 * one that opens the gate to the parser. An import can therefore reach
 * `extracting` in exactly one way, and `readOriginal` (Task 13) leans on the
 * same `scan_status = 'clean'` fact.
 */
export function scanStep(deps: UseCaseDeps) {
  return async (principal: Principal, importId: string): Promise<IngestOutcome> => {
    const found = await deps.imports.get(principal.userId, importId);
    if (!found || found.status !== "scanning") return { outcome: "skipped", reason: "not_scanning" };
    if (found.storageKey === null) return { outcome: "skipped", reason: "not_scanning" };

    // No transaction is open here. `documents.get` and `scanner.scan` are both
    // network calls; the caller (Task 14's job, or the API route) opened and
    // closed one transaction for the read above and opens another for the write
    // below.
    const bytes = await deps.documents.get(found.storageKey);
    if (bytes === null) {
      await deps.imports.patch(principal.userId, importId, { status: "failed", error: "bytes_missing", storageKey: null });
      return { outcome: "skipped", reason: "no_bytes" };
    }

    const verdict = await deps.scanner.scan(bytes);
    const scannedAt = deps.clock.now();

    if (verdict.verdict === "infected") {
      // Delete first, then record. A crash between the two leaves an orphan row
      // pointing at bytes that are gone, which the retention job tolerates; the
      // reverse order would leave real malware in the bucket with nothing
      // recording that it is there.
      await deps.documents.delete(found.storageKey);
      const updated = await deps.imports.patch(principal.userId, importId, {
        status: "rejected",
        scanStatus: "infected",
        scanner: verdict.scanner,
        scanSignature: verdict.signature,
        scannedAt,
        error: "scan_infected",
        storageKey: null,
      });
      await deps.audit({
        actorUserId: principal.userId,
        action: "payroll.import_rejected",
        entityType: "payroll_import",
        entityId: importId,
        after: { reason: "scan_infected", scanner: verdict.scanner, signature: verdict.signature },
      });
      return { outcome: "rejected_infected", import: updated! };
    }

    if (verdict.verdict === "unavailable") {
      const updated = await deps.imports.patch(principal.userId, importId, {
        status: "scanning",
        scanStatus: "unavailable",
        scanner: verdict.scanner,
        scannedAt,
        error: "scan_unavailable",
      });
      return { outcome: "scanner_unavailable", import: updated! };
    }

    const updated = await deps.imports.patch(principal.userId, importId, {
      status: "extracting",
      scanStatus: "clean",
      scanner: verdict.scanner,
      scanSignature: null,
      scannedAt,
      error: null,
    });
    return { outcome: "parsed", import: updated! };
  };
}

function confidenceMap(extraction: Awaited<ReturnType<typeof parsePayslip>>): Record<string, Confidence> {
  const out: Record<string, Confidence> = {};
  for (const [field, value] of Object.entries(extraction.fields)) {
    if (value) out[field] = value.confidence;
  }
  return out;
}

/**
 * Text acquisition and parsing. The existing engine is called, never rewritten:
 * `extractPdfText` and `parsePayslip` are exactly the functions
 * `src/lib/jobs/payslip-ingest.ts` called, with the bytes now coming from the
 * document store instead of a Paperless download.
 *
 * The one behavioural change from that job: there is no OCR fallback, because
 * Paperless was the only OCR source and it is being retired. A PDF with no
 * usable text layer parks in `needs_ocr` (Ruling R4-9) rather than being handed
 * to the parser as an empty string — which would produce a confident-looking
 * all-null extraction, the exact "invented financial data" failure.
 *
 * `month` is taken from the document title when the title states one, exactly
 * as `payslip-ingest.ts` did and for the same measured reason (`titleMonth`'s
 * own comment): the OCR-derived period resolved all twelve real payslips to
 * 2009-01. A tredicesima is filed in December of its year whatever the title
 * names.
 */
export function parseStep(deps: UseCaseDeps, ports: IngestPorts = {}) {
  const extractText = ports.extractText ?? ((bytes: Uint8Array) => extractPdfText(bytes));
  const parse = ports.parse ?? parsePayslip;
  const loadHistory = ports.history ?? (async () => []);

  return async (principal: Principal, importId: string): Promise<IngestOutcome> => {
    const found = await deps.imports.get(principal.userId, importId);
    if (!found) return { outcome: "skipped", reason: "not_scanning" };
    // The gate: nothing parses unless the scanner cleared it (Ruling R4-2).
    if (found.scanStatus !== "clean") return { outcome: "skipped", reason: "not_scanning" };
    if (found.status !== "extracting" && found.status !== "needs_ocr") {
      return { outcome: "skipped", reason: "not_scanning" };
    }
    if (found.storageKey === null) return { outcome: "skipped", reason: "no_bytes" };

    const bytes = await deps.documents.get(found.storageKey);
    if (bytes === null) {
      await deps.imports.patch(principal.userId, importId, { status: "failed", error: "bytes_missing", storageKey: null });
      return { outcome: "skipped", reason: "no_bytes" };
    }

    const text = await extractText(bytes);
    if (text === null || text.trim().length === 0) {
      const updated = await deps.imports.patch(principal.userId, importId, {
        status: "needs_ocr",
        textSource: textSourceColumn(null),
        error: "no_text_layer",
      });
      return { outcome: "needs_ocr", import: updated! };
    }

    const isThirteenth = titleIsThirteenth(found.fileName);
    const fromTitle = titleMonth(found.fileName);
    const month = fromTitle !== null && isThirteenth ? `${fromTitle.slice(0, 4)}-12-01` : fromTitle;

    const extraction = await parse({
      text,
      textSource: "pdf",
      month,
      history: await loadHistory(),
      llmOptions: await llmOptionsFromConfig(),
    });

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
