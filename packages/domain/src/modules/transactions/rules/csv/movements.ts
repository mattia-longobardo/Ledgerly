// The rows of a CSV file as manual movements (decision ST-8): each row a movement or a refusal with
// its row number and a code, never its content. Each movement has the key that makes it once. Pure.
import { createHash } from "node:crypto";
import type { z } from "zod";
import type { csvMapSchema } from "@ledgerly/api-contract";
import type { CivilDate } from "../../../../shared/dates";
import type { Cents } from "../../../../shared/money";
import type { ManualKind } from "../../manual-rules";
import { isBlank } from "./records";
import { parseAmountCell, parseDateCell } from "./values";

/** How the rows of a file become movements: the contract's shape, one source. */
export type CsvMap = z.infer<typeof csvMapSchema>;

const PAYEE_MAX = 255;
const NOTE_MAX = 2000;

/** A row that is a movement: the fields of the manual movement, and its key. */
export interface CsvMovement {
  row: number;
  key: string;
  kind: ManualKind;
  /** The size of the amount: the kind gives the sign, as for a movement written by hand. */
  amountCents: Cents;
  on: CivilDate;
  payee: string | null;
  note: string | null;
  /** The name of a category the file writes; the caller finds the person's category of that name. */
  category: string | null;
}

type CsvRow = { row: number; movement: CsvMovement } | { row: number; reason: string };

type Cells = readonly string[];

const textOf = (cells: Cells, column: number | null, max: number): string | null => {
  const text = column === null ? "" : (cells[column] ?? "").trim();
  return text === "" ? null : text.slice(0, max);
};

/** The signed amount of a row, or the code of why it has none. */
function amountOf(cells: Cells, map: CsvMap): Cents | string {
  const { amount, debit, credit } = map.columns;
  const read = (column: number | null): Cents | null | "bad" => {
    const text = column === null ? "" : (cells[column] ?? "").trim();
    if (text === "") return null;
    return parseAmountCell(text, map.decimalSeparator) ?? "bad";
  };
  if (amount !== null) {
    const value = read(amount);
    return value === "bad" ? "bad_amount" : (value ?? "no_amount");
  }
  const [out, into] = [read(debit), read(credit)];
  if (out === "bad" || into === "bad") return "bad_amount";
  if (out === null && into === null) return "no_amount";
  // A debit is money out and a credit money in, whatever sign the file writes them with.
  const size = (value: Cents | null) => (value === null ? 0n : value < 0n ? -value : value);
  return size(into) - size(out);
}

/** One record as a movement, or the code of why it is not one. */
function rowOf(cells: Cells, map: CsvMap, today: CivilDate): Omit<CsvMovement, "row" | "key"> | string {
  if (map.columns.date >= cells.length) return "missing_column";
  const day = parseDateCell(cells[map.columns.date] ?? "", map.dateFormat);
  if (day === null) return "bad_date";
  if (day > today) return "future_date";
  const amount = amountOf(cells, map);
  if (typeof amount === "string") return amount;
  if (amount === 0n) return "zero_amount";
  return {
    kind: amount < 0n ? "expense" : "income",
    amountCents: amount < 0n ? -amount : amount,
    on: day,
    payee: textOf(cells, map.columns.payee, PAYEE_MAX),
    note: textOf(cells, map.columns.note, NOTE_MAX),
    category: textOf(cells, map.columns.category, PAYEE_MAX),
  };
}

/** The text two rows must share to be the same movement: case, spaces and forms left out. */
const sameText = (movement: Omit<CsvMovement, "row" | "key">) =>
  `${movement.payee ?? ""} ${movement.note ?? ""}`
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * The key of a movement of a file: the account, the day, the signed amount, the text, and how many
 * identical rows came before it in the same file. The same file read twice gives the same keys;
 * two identical rows of one file are two movements.
 */
function csvKey(accountId: string, movement: Omit<CsvMovement, "row" | "key">, occurrence: number): string {
  const signed = movement.kind === "expense" ? -movement.amountCents : movement.amountCents;
  const hash = createHash("sha256")
    .update([accountId, movement.on, signed.toString(), sameText(movement), String(occurrence)].join("\n"))
    .digest("hex");
  return `csv:${hash}`;
}

/** The records that hold rows: after the rows to skip and the header, blank lines left out. */
export function dataRecords(records: readonly string[][], map: Pick<CsvMap, "skipRows" | "header">) {
  const first = map.skipRows + (map.header ? 1 : 0);
  return records.flatMap((cells, index) =>
    index < first || isBlank(cells) ? [] : [{ row: index + 1, cells }],
  );
}

/** Every row of the file, numbered as a spreadsheet numbers it (from 1, the header included). */
export function csvRows(
  records: readonly string[][],
  map: CsvMap,
  scope: { accountId: string; today: CivilDate },
): CsvRow[] {
  const seen = new Map<string, number>();
  return dataRecords(records, map).map(({ row, cells }) => {
    const outcome = rowOf(cells, map, scope.today);
    if (typeof outcome === "string") return { row, reason: outcome };
    const same = `${outcome.on}\n${outcome.kind}\n${outcome.amountCents}\n${sameText(outcome)}`;
    const occurrence = seen.get(same) ?? 0;
    seen.set(same, occurrence + 1);
    return { row, movement: { ...outcome, row, key: csvKey(scope.accountId, outcome, occurrence) } };
  });
}
