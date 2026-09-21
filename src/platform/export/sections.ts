import { type Cents, centsToDecimal } from "@/platform/money";
import { csvDocument } from "./csv";

/**
 * One table of an export: the same rows become a CSV and a member of the JSON, so the two can
 * never drift apart. Nothing here reads anything — `./service.ts` fills them from the modules.
 */
export interface Section {
  /** The file's name without its extension, and the key inside `ledgerly.json`. */
  name: string;
  columns: readonly string[];
  rows: readonly Row[];
}

export type Cell = string | number | boolean | null;
export type Row = Record<string, Cell>;

/** Money in an export is a canonical decimal string, never a locale's: a file is read by machines. */
export function amount(cents: Cents | null | undefined): string | null {
  return cents === null || cents === undefined ? null : centsToDecimal(cents);
}

export function day(at: Date | null | undefined): string | null {
  return at ? at.toISOString() : null;
}

export function sectionCsv(section: Section): string {
  // A boolean writes as "true"/"false", which is what a spreadsheet and a script both read back.
  return csvDocument(
    section.columns,
    section.rows.map((row) => section.columns.map((column) => cell(row[column]))),
  );
}

function cell(value: Cell): string | number | null {
  return typeof value === "boolean" ? String(value) : value;
}

/** `ledgerly.json`'s body: every section under its own name, plus whatever the caller adds. */
export function sectionsJson(sections: readonly Section[], extra: Record<string, unknown>): string {
  const body: Record<string, unknown> = { ...extra };
  for (const section of sections) body[section.name] = section.rows;
  return `${JSON.stringify(body, null, 2)}\n`;
}
