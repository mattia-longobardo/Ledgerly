import type { PayrollRecordKind } from "../application/ports";

const IT_MONTHS: Record<string, string> = {
  gennaio: "01", febbraio: "02", marzo: "03", aprile: "04",
  maggio: "05", giugno: "06", luglio: "07", agosto: "08",
  settembre: "09", ottobre: "10", novembre: "11", dicembre: "12",
};

/**
 * Ported verbatim from `src/lib/jobs/payslip-ingest.ts:103-112`, which this
 * phase deletes. Its original comment is worth keeping, with "Paperless title"
 * generalised to "document title" — the uploaded filename now plays the same
 * role the Paperless title used to:
 *
 * The title is the most reliable period source available: every payslip is
 * named "Busta Paga ... <Mese> <Anno>". It beats both alternatives, measured
 * against the real 12 documents: the OCR-derived period resolved every single
 * one to 2009-01 (it latches onto a stray year in the payslip body), which
 * collapsed them all onto one key so only one row survived; and the document
 * store's own metadata date is off by a month at least once ("Maggio 2026" was
 * filed 2026-06-01).
 */
export function titleMonth(title: string | null | undefined): string | null {
  if (!title) return null;
  const m = /\b(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\b[^0-9]{0,10}(20\d{2})\b/i.exec(
    title,
  );
  if (m) return `${m[2]}-${IT_MONTHS[m[1]!.toLowerCase()]}-01`;
  // "Tredicesima 2025" carries no month name; the 13th is always December.
  const t = /\btredicesima\b[^0-9]{0,10}(20\d{2})\b/i.exec(title);
  return t ? `${t[1]}-12-01` : null;
}

/**
 * "Tredicesima" in the title is a stronger signal than any text heuristic.
 * Ported from `payslip-ingest.ts:115-117`, with one correction: the source's
 * trailing `\b13[aª]\b` never matches, because "ª" (U+00AA) is not a `\w`
 * character in JS regex, so no boundary exists between it and a following
 * space or end of string. The lookahead below checks for "not immediately
 * followed by another word character" instead, which is what the original
 * boundary was trying to express.
 */
export function titleIsThirteenth(title: string | null | undefined): boolean {
  return /\btredicesima\b|\b13[aª](?![a-zA-Z0-9_])|\bgratifica natalizia\b/i.test(title ?? "");
}

export interface PayPeriod {
  periodStart: string;
  periodEnd: string;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A payslip covers a civil month. Computed with `Date.UTC` and read back with
 * the UTC getters, so no timezone ever shifts the boundary — these are civil
 * dates stored in `date` columns, not instants.
 */
export function periodFor(monthKey: string): PayPeriod {
  const m = DATE_RE.exec(monthKey);
  if (!m) throw new Error(`invalid month key: ${monthKey}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) throw new Error(`invalid month key: ${monthKey}`);
  // Day 0 of the next month is the last day of this one, leap years included.
  const last = new Date(Date.UTC(year, month, 0));
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    periodStart: `${m[1]}-${m[2]}-01`,
    periodEnd: `${m[1]}-${m[2]}-${pad(last.getUTCDate())}`,
  };
}

/**
 * Ruling R4-10's companion: the schema's `kind` has five values, and this phase
 * can distinguish exactly two of them. `fourteenth`, `bonus` and `settlement`
 * are creatable through the API and the review form but never inferred, because
 * nothing in the parsed text distinguishes them reliably and guessing would put
 * a wrong month in Earnings.
 */
export function recordKindOf(isThirteenth: boolean): PayrollRecordKind {
  return isThirteenth ? "thirteenth" : "ordinary";
}

/** The month key a period belongs to — what the legacy `fund_deposits` bridge keys on. */
export function monthOfPeriod(periodStart: string): string {
  const m = DATE_RE.exec(periodStart);
  if (!m) throw new Error(`invalid period start: ${periodStart}`);
  return `${m[1]}-${m[2]}-01`;
}
