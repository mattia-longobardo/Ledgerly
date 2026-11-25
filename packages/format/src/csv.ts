/**
 * One CSV, written the way a spreadsheet in Italy or in the United States opens it without being
 * asked twice: semicolon-separated, CRLF line endings, and a BOM so Excel reads it as UTF-8.
 *
 * One quoting rule for the whole application is one place to be wrong in, rather than several (plan
 * F8 P4): the data export of the server and the subscriptions' file written in the browser share it.
 */

const CSV_SEPARATOR = ";";

/** What a spreadsheet reads as the start of a formula (OWASP CSV injection, SEC-07). */
const FORMULA_START = /^[=+\-@\t\r]/;
/** A number written as text (`-12.50`, `-1.234,56`): a spreadsheet reads it as a number, never a formula. */
const NUMBER_TEXT = /^[+-]?\d[\d.,' \u00a0\u202f]*$/;

/**
 * One field: a text that would start a formula gets a leading `'`, so a spreadsheet shows it as text
 * (a number keeps its sign); then quoted when it holds a separator, a quote or a line break (RFC 4180).
 */
export function csvField(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const text =
    typeof value === "string" && FORMULA_START.test(raw) && !NUMBER_TEXT.test(raw) ? `'${raw}` : raw;
  return /[";\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** A text cell read back: the `'` `csvField` put before a formula's start taken away. */
export const csvText = (cell: string): string => cell.replace(/^'(?=[=+\-@\t\r])/, "");

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
