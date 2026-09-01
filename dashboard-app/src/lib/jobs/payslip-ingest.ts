/**
 * Payslip ingest — PLAN §4 "Detection".
 *
 * discover → text → parse → store as `parsed` (pending verification) → Gotify.
 * Idempotent on `paperless_doc_id`: a document seen twice is a no-op, which is
 * what makes the webhook a latency optimisation rather than a correctness
 * requirement (the hourly sweep polls the same documents).
 *
 * Contract: never throws. A garbage document becomes a low-confidence pending
 * row for the human gate; an upstream outage becomes a failed `job_runs` row
 * that the next sweep retries.
 */

import { errorMessage } from "@/lib/clients/http";
import { alertPayslipPending } from "@/lib/clients/gotify";
import { downloadOriginal, getDocument, type PaperlessDocument } from "@/lib/clients/paperless";
import type { JobResult } from "@/lib/contracts";
import type { PayslipHistoryEntry } from "@/lib/payroll/confidence";
import { llmOptionsFromConfig } from "@/lib/payroll/llm-config";
import { parsePayslip } from "@/lib/payroll/parse";
import { extractPdfText, type TextSource } from "@/lib/payroll/text";
import { discover, knownDocIds, storeExtraction, verifiedPayslips } from "@/lib/repo/payslips";
import { finishRun, startRun } from "@/lib/repo/jobs";
import { monthKeyOf } from "@/lib/time";

export const JOB_NAME = "payslip_ingest" as const;

export type IngestTrigger = "webhook" | "sweep" | "manual";

export interface IngestPayslipInput {
  /** Paperless document id. The webhook body is a hint; this is re-fetched. */
  docId: number;
  trigger: IngestTrigger;
}

interface AcquiredText {
  text: string;
  textSource: TextSource;
  note?: string;
}

/**
 * PDF text layer first — it keeps the vacation grid's columns intact. Paperless
 * OCR is the fallback and is flagged as such so the parser can demote
 * column-associated fields (PLAN §4).
 */
async function acquireText(doc: PaperlessDocument): Promise<AcquiredText> {
  let note: string | undefined;
  try {
    const original = await downloadOriginal(doc.id);
    const pdfText = await extractPdfText(new Uint8Array(original.data));
    if (pdfText && pdfText.trim().length > 0) {
      return { text: pdfText, textSource: "pdf" };
    }
    note = "no usable PDF text layer; fell back to Paperless OCR";
  } catch (err) {
    // Download failures must not lose the document: the OCR text is already in
    // the metadata we hold.
    note = `PDF download failed, using Paperless OCR: ${errorMessage(err)}`;
  }
  return { text: doc.content ?? "", textSource: "ocr", ...(note ? { note } : {}) };
}

function toNumber(value: string | null): number | null {
  return value === null ? null : Number(value);
}

/** Prior verified payslips power the continuity and median checks. */
async function loadHistory(): Promise<PayslipHistoryEntry[]> {
  const rows = await verifiedPayslips();
  return rows.map((r) => ({
    month: r.month,
    isThirteenth: r.isThirteenth,
    net: toNumber(r.net),
    gross: toNumber(r.gross),
    taxes: toNumber(r.taxes),
    ferieBalance: toNumber(r.ferieBalance),
    rolBalance: toNumber(r.rolBalance),
  }));
}

/** Paperless `created` is the document's own date; `added` is when it landed. */
function metadataMonth(doc: PaperlessDocument): string {
  return monthKeyOf(doc.created ?? doc.added);
}

const IT_MONTHS: Record<string, string> = {
  gennaio: "01", febbraio: "02", marzo: "03", aprile: "04",
  maggio: "05", giugno: "06", luglio: "07", agosto: "08",
  settembre: "09", ottobre: "10", novembre: "11", dicembre: "12",
};

/**
 * The Paperless title is the most reliable period source we have: every payslip
 * is named "Busta Paga ... <Mese> <Anno>".
 *
 * It beats both alternatives, measured against the real 12 documents:
 * the OCR-derived period resolved every single one to 2009-01 (it latches onto
 * a stray year in the payslip body), which collapsed them all onto the same
 * `UNIQUE (month, is_thirteenth)` key so only one row survived; and Paperless
 * `created` is off by a month at least once ("Maggio 2026" is filed 2026-06-01).
 */
function titleMonth(title: string | null | undefined): string | null {
  if (!title) return null;
  const m = /\b(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\b[^0-9]{0,10}(20\d{2})\b/i.exec(
    title,
  );
  if (m) return `${m[2]}-${IT_MONTHS[m[1]!.toLowerCase()]}-01`;
  // "Tredicesima 2025" carries no month name; the 13th is always December.
  const t = /\btredicesima\b[^0-9]{0,10}(20\d{2})\b/i.exec(title);
  return t ? `${t[1]}-12-01` : null;
}

/** "Tredicesima" in the title is a stronger signal than any text heuristic. */
function titleIsThirteenth(title: string | null | undefined): boolean {
  return /\btredicesima\b|\b13[aª]\b|\bgratifica natalizia\b/i.test(title ?? "");
}

export async function ingestPayslipDocument(input: IngestPayslipInput): Promise<JobResult> {
  const dedupeKey = String(input.docId);
  const run = await startRun({ jobName: JOB_NAME, trigger: input.trigger, dedupeKey });

  try {
    // Cheap idempotency check first, so a re-delivered webhook never downloads
    // a PDF. `discover()` below is still the authoritative guard against a race.
    const known = await knownDocIds();
    if (known.includes(input.docId)) {
      const detail = { docId: input.docId, reason: "document_already_ingested" };
      await finishRun(run.id, "already_done", { detail });
      return { job: JOB_NAME, status: "already_done", detail };
    }

    const doc = await getDocument(input.docId);
    const { text, textSource, note } = await acquireText(doc);
    const history = await loadHistory();

    // `month: null` lets the parser read the pay period out of the document
    // itself; Paperless metadata is the fallback, being user-editable.
    // The LLM config is resolved per run (Settings over env, see
    // `llm-config.ts`) so repointing the provider takes effect on the next
    // payslip without a restart. It never throws: an unconfigured LLM just
    // means the deterministic rules pass stands alone.
    const extraction = await parsePayslip({
      text,
      textSource,
      month: null,
      history,
      llmOptions: await llmOptionsFromConfig(),
    });
    const isThirteenth = titleIsThirteenth(doc.title) || extraction.isThirteenth;
    const dated = titleMonth(doc.title) ?? extraction.month ?? metadataMonth(doc);
    // A tredicesima is always December of its year (PLAN.md §4), whatever month
    // the title happens to name — "Tredicesima 2025" carries no month at all.
    const month = isThirteenth ? `${dated.slice(0, 4)}-12-01` : dated;

    const row = await discover(input.docId, month, isThirteenth);
    if (!row) {
      // Lost the race against a concurrent webhook/sweep for the same document.
      const detail = { docId: input.docId, reason: "document_already_ingested" };
      await finishRun(run.id, "already_done", { detail });
      return { job: JOB_NAME, status: "already_done", detail };
    }

    const stored = await storeExtraction(row.id, { ...extraction, month, isThirteenth });
    const payslipId = stored?.id ?? row.id;

    await alertPayslipPending({
      payslipId,
      month,
      title: doc.title,
    });

    const lowConfidence = Object.values(extraction.fields).filter(
      (f) => f.confidence === "low",
    ).length;
    const detail = {
      docId: input.docId,
      payslipId,
      month,
      textSource,
      isThirteenth: extraction.isThirteenth,
      lowConfidenceFields: lowConfidence,
      ...(note ? { note } : {}),
    };
    await finishRun(run.id, "success", { detail });
    return { job: JOB_NAME, status: "success", detail };
  } catch (err) {
    const message = errorMessage(err);
    const detail = { docId: input.docId };
    // No Gotify here: the hourly sweep re-polls the same document, so an
    // upstream blip would otherwise alert every time it is retried.
    await finishRun(run.id, "failed", { error: message, detail });
    return { job: JOB_NAME, status: "failed", error: message, detail };
  }
}
