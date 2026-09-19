import { addDays, type CivilDate } from "@/platform/dates";

export const DOCUMENT_KINDS = ["payslip", "cometa_operations", "cometa_position"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** The document states of spec §7.8, one list for every kind of document (§9.3). */
export const DOCUMENT_STATES = [
  "received",
  "scanning",
  "extracting",
  "needs_review",
  "needs_ocr",
  "verified",
  "applied",
  "superseded",
  "rejected",
  "failed",
] as const;
export type DocumentState = (typeof DOCUMENT_STATES)[number];

export const EVIDENCE_ORIGINS = ["printed", "derived", "inferred"] as const;
export type EvidenceOrigin = (typeof EVIDENCE_ORIGINS)[number];

export const EVIDENCE_UNITS = ["eur", "hours", "text", "date"] as const;
export type EvidenceUnit = (typeof EVIDENCE_UNITS)[number];

export const VERIFICATION_STATES = ["unverified", "confirmed", "corrected"] as const;
export type VerificationState = (typeof VERIFICATION_STATES)[number];

/**
 * The transitions of spec §7.8, the only ones a service may ask the database for. `extracting` is
 * reachable again from every state a person can "Retry" (plan F5 §3.4.2); `applied` only ever
 * gives way to a rectification (`superseded`), and `superseded` is final.
 */
const TRANSITIONS: Record<DocumentState, readonly DocumentState[]> = {
  received: ["scanning", "failed"],
  scanning: ["extracting", "failed", "rejected"],
  extracting: ["needs_review", "needs_ocr", "failed"],
  needs_review: ["verified", "rejected", "extracting"],
  needs_ocr: ["rejected", "extracting"],
  verified: ["applied", "needs_review", "rejected", "extracting"],
  applied: ["superseded"],
  superseded: [],
  rejected: ["extracting"],
  failed: ["extracting", "rejected"],
};

export function canTransition(from: DocumentState, to: DocumentState): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Every state `to` may be entered from: the `WHERE state IN (…)` of a conditional update. */
export function sourcesOf(to: DocumentState): DocumentState[] {
  return DOCUMENT_STATES.filter((from) => canTransition(from, to));
}

/** States in which the document still waits for someone (the "N to review" pill, spec §7.8). */
export const AWAITING_REVIEW: readonly DocumentState[] = ["needs_review", "needs_ocr", "verified"];

/** States whose document is still being read: the hourly sweep picks up the stuck ones. */
export const IN_FLIGHT: readonly DocumentState[] = ["received", "scanning", "extracting"];

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** Fewer characters of text than this on every page together: the PDF needs OCR (spec D11). */
export const MIN_TEXT_CHARS = 200;

/** How long an original is kept by default (spec §7.8); an admin setting from F8. */
export const RETENTION_YEARS = 10;

export type SniffedFormat = "pdf" | "xls_html" | "xls" | "xlsx";

const startsWith = (bytes: Uint8Array, signature: readonly number[], at = 0) =>
  signature.every((byte, index) => bytes[at + index] === byte);

/**
 * The format read from the content, never from the name or the declared type (spec §9.3): the PDF
 * signature (anywhere in the first KiB, as readers allow), the OLE2 header of `.xls`, the ZIP
 * header of `.xlsx`, and the HTML table Cometa exports under an `.xls` name.
 */
export function sniffFormat(bytes: Uint8Array): SniffedFormat | null {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  if (head.includes("%PDF-")) return "pdf";
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "xls";
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return "xlsx";
  if (/<(?:html|table)[\s>]/i.test(head)) return "xls_html";
  return null;
}

/** The formats each kind of document is read from. */
export const FORMATS_OF: Record<DocumentKind, readonly SniffedFormat[]> = {
  payslip: ["pdf"],
  cometa_operations: ["xls_html", "xls", "xlsx"],
  cometa_position: ["pdf"],
};

export const MIME_OF: Record<SniffedFormat, string> = {
  pdf: "application/pdf",
  xls_html: "text/html",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const FOLDER_OF: Record<DocumentKind, string> = {
  payslip: "payslips",
  cometa_operations: "cometa",
  cometa_position: "cometa",
};

const EXTENSION_OF: Record<SniffedFormat, string> = { pdf: "pdf", xls_html: "xls", xls: "xls", xlsx: "xlsx" };

/**
 * Where an original lives in S3 (spec §7.8): `payslips/<userId>/<year>/<random>.pdf`. Nothing in
 * the key comes from the person: the name they gave the file stays in the database.
 */
export function storageKeyFor(
  kind: DocumentKind,
  userId: string,
  year: number,
  random: string,
  format: SniffedFormat,
): string {
  return `${FOLDER_OF[kind]}/${userId}/${year}/${random}.${EXTENSION_OF[format]}`;
}

/** The last day an original is kept: `years` after the day it arrived. */
export function retentionEnd(receivedOn: CivilDate, years = RETENTION_YEARS): CivilDate {
  const [year, month, day] = receivedOn.split("-").map(Number);
  const target = new Date(Date.UTC(year + years, month - 1, day));
  // 29 February becomes 28 February in a year that has none, never 1 March.
  const date = target.toISOString().slice(0, 10);
  return target.getUTCMonth() === month - 1 ? date : addDays(date, -1);
}

/** A file name fit to show and to put in a `Content-Disposition`: no path, no control characters. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[\u0000-\u001f\u007f"]/g, "").trim();
  return (clean === "" ? "document" : clean).slice(0, 200);
}
