/**
 * Text acquisition + normalisation for the payslip pipeline.
 *
 * Two sources, in preference order:
 *   1. the PDF's embedded text layer (`pdf`) — keeps the vacation grid intact;
 *   2. Paperless-ngx OCR `content` (`ocr`) — flattens the grid, so
 *      column-association fields start at reduced confidence (PLAN §4).
 */

export type TextSource = "pdf" | "ocr";

/**
 * Contract for the layout-aware primary source. Implementations return `null`
 * when the PDF carries no usable text layer, which makes the caller fall back
 * to the Paperless OCR `content`.
 */
export interface PdfTextExtractor {
  (buffer: Uint8Array): Promise<string | null>;
}

/**
 * Reads the PDF's embedded text layer via `unpdf` (a prebuilt pdf.js bundle —
 * no native deps, runs in the Next.js node runtime).
 *
 * `mergePages: false` keeps one string per page: the payslip's vacation grid
 * lives on a single page, and merging pages would let a page break masquerade
 * as a row break in the grid reader.
 *
 * Never throws — a missing or unreadable text layer is an expected outcome
 * that must degrade to the Paperless OCR fallback, not break ingestion. A
 * scanned-image payslip legitimately has no text layer at all.
 */
export const extractPdfText: PdfTextExtractor = async (buffer: Uint8Array) => {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const doc = await getDocumentProxy(buffer);
    const { text } = await extractText(doc, { mergePages: false });
    const pages = Array.isArray(text) ? text : [text];
    const joined = pages.filter(Boolean).join("\n");
    // A text layer of a few stray glyphs means the PDF is really a scan.
    return joined.replace(/\s/g, "").length < MIN_PDF_TEXT_CHARS ? null : joined;
  } catch {
    return null;
  }
};

/** Below this, the "text layer" is noise and OCR is the better source. */
const MIN_PDF_TEXT_CHARS = 200;

/** Characters OCR routinely emits in place of the real glyph, inside numbers. */
const OCR_DIGIT_CONFUSIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/[Oo]/g, "0"],
  [/[lI|]/g, "1"],
  [/[Ss]/g, "5"],
  [/[Bb]/g, "8"],
];

/** A token that already looks like a clean Italian number needs no repair. */
const CLEAN_NUMBER = /^[+-]?\d{1,3}(?:\.\d{3})*(?:,\d{1,4})?[-]?$|^[+-]?\d+(?:,\d{1,4})?[-]?$/;

/**
 * Repairs OCR confusions *only* when the result is unambiguously a number:
 * the token must already contain a digit and must parse cleanly after the
 * substitution. Anything else is left untouched — corrupting a label is far
 * worse than leaving one bad amount for the human gate to catch.
 */
export function fixNumericOcr(token: string): string {
  if (CLEAN_NUMBER.test(token)) return token;
  if (!/\d/.test(token)) return token;
  if (!/[OolI|SsBb]/.test(token)) return token;
  let fixed = token;
  for (const [pattern, digit] of OCR_DIGIT_CONFUSIONS) fixed = fixed.replace(pattern, digit);
  return CLEAN_NUMBER.test(fixed) ? fixed : token;
}

/**
 * Collapses whitespace and repairs numeric OCR confusions while preserving the
 * line structure the anchor engine relies on. Column *positions* are lost by
 * design — the rules engine works on token order, not on x-offsets.
 */
export function normalizeText(raw: string | null | undefined): string {
  if (!raw) return "";
  const unified = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u00A0\u202F\u2007\u2009]/g, " ")
    .replace(/\u2212/g, "-")
    .replace(/[\u2018\u2019\u201B]/g, "'");

  const lines: string[] = [];
  for (const line of unified.split("\n")) {
    const collapsed = line.replace(/[\t\f\v ]+/g, " ").trim();
    if (!collapsed) continue;
    lines.push(
      collapsed
        .split(" ")
        .map((token) => fixNumericOcr(token))
        .join(" "),
    );
  }
  return lines.join("\n");
}

/** Non-empty, trimmed lines of already-normalized text. */
export function splitLines(text: string): string[] {
  if (!text) return [];
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}
