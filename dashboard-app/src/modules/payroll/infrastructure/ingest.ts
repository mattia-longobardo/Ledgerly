import { db } from "@/lib/db";
import { llmOptionsFromConfig } from "@/lib/payroll/llm-config";
import { parsePayslip } from "@/lib/payroll/parse";
import { extractPdfText } from "@/lib/payroll/text";
import type { Principal } from "@/platform/auth/principal";
import { withUserContext } from "@/platform/db/context";
import {
  applyParseConclusion,
  applyScanConclusion,
  beginParse,
  beginScan,
  type IngestOutcome,
  type IngestPorts,
  type ScanConclusion,
} from "../application/ingest-import";
import { InvalidInputError } from "../application/errors";
import { titleIsThirteenth, titleMonth } from "../domain/period";
import type { MalwareScanner } from "../application/ports";
import { payrollDeps } from "./deps";
import { resolveDocumentStore } from "./document-store-resolver";
import { resolveScanner } from "./scanner-resolver";

const NO_STORE_MESSAGE = "No payroll document store is configured. Connect one in Settings › Integrations.";

export interface ScanImportOptions {
  requestId?: string | null;
  /** Injected in tests so the suite can drive every verdict without a real clamd. Defaults to `resolveScanner()`. */
  scanner?: MalwareScanner;
}

/**
 * The scan, as three short steps with the clamd round trip between two of
 * them — the same decomposition `uploadPayslip` (Task 9) applies to the
 * upload path, now applied to the scan boundary (Ruling R4-8, Ruling R4-2;
 * PH4-C7).
 *
 * 1. Resolve the store and the scanner — network I/O and credential
 *    decryption, done before any transaction opens.
 * 2. Transaction one: confirm the import is actually waiting to be scanned
 *    (`beginScan`).
 * 3. **No transaction**: fetch the bytes, run the scanner, and — for an
 *    infected verdict — delete the object. All three are network calls; none
 *    may run while a Postgres transaction is open.
 * 4. Transaction two: record the conclusion (`applyScanConclusion`).
 *
 * This is the atomic "scan one import" operation Task 14's job dispatches
 * per row; nothing here holds a transaction open across step 3.
 */
export async function scanImport(principal: Principal, importId: string, opts: ScanImportOptions = {}): Promise<IngestOutcome> {
  const resolution = await resolveDocumentStore(principal.userId);
  if (!resolution) throw new InvalidInputError(NO_STORE_MESSAGE);
  const scanner = opts.scanner ?? resolveScanner();
  const depsOpts = { documents: resolution.store, scanner, requestId: opts.requestId ?? null };

  const begin = await withUserContext(db, { userId: principal.userId }, (tx) =>
    beginScan(payrollDeps(tx, depsOpts))(principal, importId),
  );
  if (!begin.ready) return begin.outcome;

  const bytes = await resolution.store.get(begin.storageKey);
  if (bytes === null) {
    return withUserContext(db, { userId: principal.userId }, (tx) =>
      applyScanConclusion(payrollDeps(tx, depsOpts))(principal, importId, { kind: "bytes_missing" }),
    );
  }

  const verdict = await scanner.scan(bytes);
  let conclusion: ScanConclusion;
  if (verdict.verdict === "infected") {
    // Delete before the write, never after: a crash between the two leaves an
    // orphan row (tolerated by the retention job) rather than real malware
    // still sitting in the bucket with nothing recording that it is there.
    await resolution.store.delete(begin.storageKey);
    conclusion = { kind: "infected", scanner: verdict.scanner, signature: verdict.signature };
  } else if (verdict.verdict === "unavailable") {
    conclusion = { kind: "unavailable", scanner: verdict.scanner };
  } else {
    conclusion = { kind: "clean", scanner: verdict.scanner };
  }

  return withUserContext(db, { userId: principal.userId }, (tx) =>
    applyScanConclusion(payrollDeps(tx, depsOpts))(principal, importId, conclusion),
  );
}

export interface ParseImportOptions extends IngestPorts {
  requestId?: string | null;
}

/**
 * Text acquisition and parsing, decomposed the same way (PH4-C7). The
 * existing engine is called, never rewritten: `extractPdfText` and
 * `parsePayslip` are exactly the functions `src/lib/jobs/payslip-ingest.ts`
 * called, with the bytes now coming from the document store instead of a
 * Paperless download.
 *
 * The one behavioural change from that job: there is no OCR fallback,
 * because Paperless was the only OCR source and it is being retired. A PDF
 * with no usable text layer parks in `needs_ocr` (Ruling R4-9) rather than
 * being handed to the parser as an empty string.
 *
 * `month` is taken from the document title when the title states one, exactly
 * as `payslip-ingest.ts` did and for the same measured reason (`titleMonth`'s
 * own comment): the OCR-derived period resolved all twelve real payslips to
 * 2009-01. A tredicesima is filed in December of its year whatever the title
 * names.
 */
export async function parseImport(principal: Principal, importId: string, opts: ParseImportOptions = {}): Promise<IngestOutcome> {
  const resolution = await resolveDocumentStore(principal.userId);
  if (!resolution) throw new InvalidInputError(NO_STORE_MESSAGE);
  const scanner = resolveScanner();
  const depsOpts = { documents: resolution.store, scanner, requestId: opts.requestId ?? null };

  const begin = await withUserContext(db, { userId: principal.userId }, (tx) =>
    beginParse(payrollDeps(tx, depsOpts))(principal, importId),
  );
  if (!begin.ready) return begin.outcome;

  const bytes = await resolution.store.get(begin.storageKey);
  if (bytes === null) {
    return withUserContext(db, { userId: principal.userId }, (tx) =>
      applyParseConclusion(payrollDeps(tx, depsOpts))(principal, importId, { kind: "bytes_missing" }),
    );
  }

  const extractText = opts.extractText ?? ((b: Uint8Array) => extractPdfText(b));
  const text = await extractText(bytes);
  if (text === null || text.trim().length === 0) {
    return withUserContext(db, { userId: principal.userId }, (tx) =>
      applyParseConclusion(payrollDeps(tx, depsOpts))(principal, importId, { kind: "no_text_layer" }),
    );
  }

  const parse = opts.parse ?? parsePayslip;
  const loadHistory = opts.history ?? (async () => []);
  const isThirteenth = titleIsThirteenth(begin.fileName);
  const fromTitle = titleMonth(begin.fileName);
  const month = fromTitle !== null && isThirteenth ? `${fromTitle.slice(0, 4)}-12-01` : fromTitle;

  const extraction = await parse({
    text,
    textSource: "pdf",
    month,
    history: await loadHistory(),
    llmOptions: await llmOptionsFromConfig(),
  });

  return withUserContext(db, { userId: principal.userId }, (tx) =>
    applyParseConclusion(payrollDeps(tx, depsOpts))(principal, importId, { kind: "parsed", extraction }),
  );
}
