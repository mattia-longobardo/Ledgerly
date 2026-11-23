// The records of a CSV file (RFC 4180): fields in double quotes may hold the delimiter, a line break
// and a quote written twice; lines end with CRLF, LF or CR. Pure: no database, no clock.

/** The text of a file: UTF-8 (its BOM dropped), or Windows-1252 when the bytes are not UTF-8. */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // shortcut: a file in another legacy encoding reads as Windows-1252; add a choice if a bank needs one.
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

interface Reading {
  records: string[][];
  record: string[];
  field: string;
  quoted: boolean;
}

function endField(reading: Reading): void {
  reading.record.push(reading.field);
  reading.field = "";
}

function endRecord(reading: Reading): void {
  endField(reading);
  reading.records.push(reading.record);
  reading.record = [];
}

/** One character inside quotes; returns where the next one is. */
function readQuoted(reading: Reading, text: string, offset: number): number {
  const char = text[offset];
  if (char !== '"') {
    reading.field += char;
    return offset + 1;
  }
  if (text[offset + 1] === '"') {
    reading.field += '"';
    return offset + 2;
  }
  reading.quoted = false;
  return offset + 1;
}

/** One character outside quotes; returns where the next one is. */
function readPlain(reading: Reading, text: string, offset: number, delimiter: string): number {
  const char = text[offset];
  if (char === delimiter) {
    endField(reading);
    return offset + 1;
  }
  if (char === "\r" || char === "\n") {
    endRecord(reading);
    return offset + (char === "\r" && text[offset + 1] === "\n" ? 2 : 1);
  }
  // A quote opens a quoted field only at its start; elsewhere it is a character of the field.
  if (char === '"' && reading.field === "") reading.quoted = true;
  else reading.field += char;
  return offset + 1;
}

/** Every record of the text, blank lines included (a record of one empty field). */
export function parseRecords(text: string, delimiter: string): string[][] {
  const reading: Reading = { records: [], record: [], field: "", quoted: false };
  let offset = 0;
  while (offset < text.length) {
    offset = reading.quoted ? readQuoted(reading, text, offset) : readPlain(reading, text, offset, delimiter);
  }
  if (reading.field !== "" || reading.record.length > 0) endRecord(reading);
  return reading.records;
}

/** A record with no value in any field: a blank line. */
export const isBlank = (record: readonly string[]) => record.every((field) => field.trim() === "");

const DELIMITERS = [";", ",", "\t", "|"] as const;
/** How much of the file the detection reads: enough for a few dozen rows. */
const SAMPLE_CHARS = 64 * 1024;
const SAMPLE_RECORDS = 20;

/** How well `delimiter` splits the sample: the rows with the most common width, and that width. */
function fitOf(sample: string, delimiter: string): { rows: number; width: number } {
  const records = parseRecords(sample, delimiter)
    .filter((record) => !isBlank(record))
    .slice(0, SAMPLE_RECORDS);
  const widths = new Map<number, number>();
  for (const record of records) widths.set(record.length, (widths.get(record.length) ?? 0) + 1);
  let best = { rows: 0, width: 1 };
  for (const [width, rows] of widths) {
    if (width > 1 && (rows > best.rows || (rows === best.rows && width > best.width))) best = { rows, width };
  }
  return best;
}

/** The delimiter that splits the first rows into the same number of columns most often. */
export function detectDelimiter(text: string): string {
  const sample = text.slice(0, SAMPLE_CHARS);
  let chosen: { delimiter: string; rows: number; width: number } = { delimiter: ";", rows: 0, width: 1 };
  for (const delimiter of DELIMITERS) {
    const fit = fitOf(sample, delimiter);
    if (fit.rows > chosen.rows || (fit.rows === chosen.rows && fit.width > chosen.width)) {
      chosen = { delimiter, ...fit };
    }
  }
  return chosen.delimiter;
}
