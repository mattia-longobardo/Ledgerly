// The map a file proposes for itself: the header's names when it has one, the values otherwise.
// The person checks it in the preview before an import. Pure.
import type { CsvMap } from "./movements";
import { isBlank } from "./records";
import { detectDateFormat, detectDecimal, parseAmountCell } from "./values";

type Role = "date" | "amount" | "debit" | "credit" | "payee" | "note" | "category";

/** The words a header uses for each column, in the languages of the banks a person may have. */
const HEADER_WORDS: readonly (readonly [Role, readonly string[]])[] = [
  ["date", ["data", "date", "datum", "fecha", "giorno"]],
  ["debit", ["addebit", "uscit", "dare", "debit", "soll", "withdraw", "spes"]],
  ["credit", ["accredit", "entrat", "avere", "credit", "haben", "deposit"]],
  ["amount", ["importo", "amount", "betrag", "importe", "montant", "valore"]],
  ["category", ["categor", "kategor"]],
  ["note", ["note", "memo", "riferiment", "reference"]],
  [
    "payee",
    [
      "descri",
      "beneficiar",
      "payee",
      "causale",
      "controparte",
      "esercente",
      "merchant",
      "name",
      "nome",
      "dettagl",
      "detail",
    ],
  ],
];

const SAMPLE_ROWS = 20;

type Columns = Partial<Record<Role, number>>;

/** Each role's column from the header's names: the first column that names it, each column once. */
function byHeader(header: readonly string[]): Columns {
  const columns: Columns = {};
  const taken = new Set<number>();
  for (const [role, words] of HEADER_WORDS) {
    const place = header.findIndex(
      (name, index) => !taken.has(index) && words.some((word) => name.toLowerCase().includes(word)),
    );
    if (place < 0) continue;
    columns[role] = place;
    taken.add(place);
  }
  return columns;
}

const cellsOf = (rows: readonly string[][], column: number) => rows.map((row) => row[column] ?? "");

/** The first column, not taken, where most filled cells pass `fits` (a bad row is the person's to see). */
function firstColumn(
  rows: readonly string[][],
  taken: ReadonlySet<number>,
  fits: (cell: string) => boolean,
): number | undefined {
  const width = Math.max(0, ...rows.map((row) => row.length));
  for (let column = 0; column < width; column += 1) {
    if (taken.has(column)) continue;
    const filled = cellsOf(rows, column).filter((cell) => cell.trim() !== "");
    if (filled.length > 0 && filled.filter(fits).length * 2 > filled.length) return column;
  }
  return undefined;
}

/** The column with the longest texts, not taken: the payee of a file with no header. */
function textColumn(rows: readonly string[][], taken: ReadonlySet<number>): number | undefined {
  const width = Math.max(0, ...rows.map((row) => row.length));
  let best: { column: number; length: number } | undefined;
  for (let column = 0; column < width; column += 1) {
    if (taken.has(column)) continue;
    const length = cellsOf(rows, column).join("").length;
    if (length > 0 && (best === undefined || length > best.length)) best = { column, length };
  }
  return best?.column;
}

/** The roles the header did not name, from the values of the rows. */
function byValues(rows: readonly string[][], named: Columns): Columns {
  const columns = { ...named };
  const taken = () => new Set(Object.values(columns));
  if (columns.date === undefined) {
    columns.date = firstColumn(rows, taken(), (cell) => detectDateFormat([cell]) !== null);
  }
  if (columns.amount === undefined && columns.debit === undefined && columns.credit === undefined) {
    const decimal = detectDecimal(rows.flat());
    columns.amount = firstColumn(rows, taken(), (cell) => parseAmountCell(cell, decimal) !== null);
  }
  columns.payee ??= textColumn(rows, taken());
  return columns;
}

/** A first record that is a header: none of its cells is a day. */
const isHeader = (record: readonly string[]) => record.every((cell) => detectDateFormat([cell]) === null);

/** The amount's columns: one signed column, or the debit and the credit; `null` when none. */
function amountColumns(columns: Columns): Pick<CsvMap["columns"], "amount" | "debit" | "credit"> | null {
  const { amount, debit, credit } = columns;
  if (debit !== undefined || credit !== undefined) {
    return { amount: null, debit: debit ?? null, credit: credit ?? null };
  }
  return amount === undefined ? null : { amount, debit: null, credit: null };
}

/** The map a file proposes, or `null` when no column of days or of amounts is found. */
export function proposeMap(records: readonly string[][], delimiter: string): CsvMap | null {
  const filled = records.filter((record) => !isBlank(record));
  const [first] = filled;
  if (first === undefined) return null;
  const header = isHeader(first);
  const rows = filled.slice(header ? 1 : 0, (header ? 1 : 0) + SAMPLE_ROWS);
  const columns = byValues(rows, header ? byHeader(first) : {});
  const amounts = amountColumns(columns);
  const dateFormat = columns.date === undefined ? null : detectDateFormat(cellsOf(rows, columns.date));
  if (columns.date === undefined || amounts === null || dateFormat === null) return null;
  const amountCells = Object.values(amounts).flatMap((column) =>
    column === null ? [] : cellsOf(rows, column),
  );
  return {
    columns: {
      date: columns.date,
      ...amounts,
      payee: columns.payee ?? null,
      note: columns.note ?? null,
      category: columns.category ?? null,
    },
    delimiter,
    decimalSeparator: detectDecimal(amountCells),
    dateFormat,
    // The header is the first filled record: the blank lines before it are skipped with it.
    skipRows: records.indexOf(first),
    header,
  };
}
