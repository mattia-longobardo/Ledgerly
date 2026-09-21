/**
 * One CSV, written the way a spreadsheet in Italy or in the United States opens it without being
 * asked twice: semicolon-separated, CRLF line endings, and a BOM so Excel reads it as UTF-8.
 *
 * Lifted out of `subscriptions/export.csv/route.ts`, which had its own `field()` (plan F8 P4): one
 * quoting rule for the whole application is one place to be wrong in, rather than several.
 */

export const CSV_SEPARATOR = ";";

/** One field, quoted when it holds a separator, a quote or a line break (RFC 4180). */
export function csvField(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[";\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function csvRow(values: readonly (string | number | null | undefined)[]): string {
  return values.map(csvField).join(CSV_SEPARATOR);
}

/** A whole document: the BOM, the header, the rows, and a final line break. */
export function csvDocument(
  header: readonly string[],
  rows: readonly (readonly (string | number | null | undefined)[])[],
): string {
  return `﻿${[csvRow(header), ...rows.map(csvRow)].join("\r\n")}\r\n`;
}
