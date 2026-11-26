/**
 * The labels of an export of categorised records (PERS-634, decision 13A): every row of a CSV whose
 * header names `category; amount; type; note; date; transfer; payee` — the export of the app a
 * person kept their money in before — read as a text and the category they gave it, for the
 * classifier and the memory to learn from. No movement is made from one. Pure: records in, labels out.
 */
import { parseAmountCell } from "./csv/values";
import { DEFAULT_CATEGORIES, type GroupKey } from "../categorize/tables";

/** One row of the export, as the cascade learns it. */
interface ExportLabel {
  kind: "income" | "expense";
  /** The export's name of the category: a sub-category, or a group filed as such. */
  category: string;
  payee: string | null;
  note: string | null;
  /** Signed as a movement's: an expense is negative. */
  amountCents: bigint;
  at: Date;
}

interface ExportRows {
  labels: ExportLabel[];
  /** Giroconti: no category here, nothing to learn (PERS-627). */
  transfers: number;
  /** The export's own «Unknown» buckets: nobody chose a category. */
  unknown: number;
  /** A row with no amount, no date or no type that can be read. */
  unreadable: number;
}

const COLUMNS = ["category", "amount", "type", "note", "date", "transfer", "payee"] as const;
/** The export's buckets for a record nobody categorised. */
const UNKNOWN = /^(unknown( income| expense)?|uncategori[sz]ed|to be categori[sz]ed|missing)$/;

/**
 * The export's moment: ISO 8601 with its zone (`2025-03-10T10:00:00.000Z`, as the export writes it) or a
 * day alone. Anything else — a day first, a time with no zone — is not read: it would be another day,
 * or one that depends on the server's zone.
 */
const MOMENT = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2}))?$/;

/** The moment of a `date` cell, or `null` when it is not one `MOMENT` reads or the day does not exist. */
function exportMoment(cell: string): Date | null {
  const text = cell.trim();
  const parts = MOMENT.exec(text);
  if (parts === null) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  // `2025-02-30` is not a day: a calendar that rolls it over to March says so.
  const day = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])));
  const real = day.getUTCMonth() === Number(parts[2]) - 1 && day.getUTCDate() === Number(parts[3]);
  return real ? date : null;
}

const plain = (text: string) => text.trim().toLowerCase();
const orNull = (text: string | undefined) => (text === undefined || text.trim() === "" ? null : text.trim());

type Column = (typeof COLUMNS)[number];
type Cell = (row: readonly string[], name: Column) => string;

/** One row: a label, or why it is left out. */
function labelOf(row: readonly string[], cell: Cell): ExportLabel | "transfers" | "unknown" | "unreadable" {
  if (plain(cell(row, "transfer")) === "true") return "transfers";
  const category = cell(row, "category").trim();
  if (category === "" || UNKNOWN.test(plain(category))) return "unknown";
  const type = plain(cell(row, "type"));
  const size = parseAmountCell(cell(row, "amount"), ".");
  const date = exportMoment(cell(row, "date"));
  if ((type !== "income" && type !== "expense") || size === null || date === null) {
    return "unreadable";
  }
  // The export writes the size and says the sign in `type`.
  const magnitude = size < 0n ? -size : size;
  return {
    kind: type,
    category,
    payee: orNull(cell(row, "payee")),
    note: orNull(cell(row, "note")),
    amountCents: type === "expense" ? -magnitude : magnitude,
    at: date,
  };
}

/** The labels of the records of an export; `null` when the header lacks one of `COLUMNS`. */
export function exportLabels(records: readonly string[][]): ExportRows | null {
  const [header, ...rows] = records;
  if (header === undefined) return null;
  const places = COLUMNS.map((name) => header.findIndex((title) => plain(title) === name));
  if (places.includes(-1)) return null;
  const cell: Cell = (row, name) => row[places[COLUMNS.indexOf(name)]] ?? "";

  const result: ExportRows = { labels: [], transfers: 0, unknown: 0, unreadable: 0 };
  for (const row of rows) {
    if (row.every((field) => field.trim() === "")) continue;
    const label = labelOf(row, cell);
    if (typeof label === "string") result[label] += 1;
    else result.labels.push(label);
  }
  return result;
}

/**
 * The person's category for an export's name: the category of the default tree with that name (in
 * either language) and that sign — the default tree is the one the export's app uses (PERS-632) —
 * else one of the
 * person's own with that name and that sign, when only one has it. `null`: nothing to learn.
 */
export function categoryForName(
  name: string,
  kind: "income" | "expense",
  groupCategory: ReadonlyMap<GroupKey, string>,
  own: readonly { id: string; name: string; type: string }[],
): string | null {
  const wanted = plain(name);
  const fromTree = DEFAULT_CATEGORIES.filter(
    (one) => one.type === kind && (plain(one.en) === wanted || plain(one.it) === wanted),
  )
    .map((one) => groupCategory.get(one.key))
    .find((id) => id !== undefined);
  if (fromTree !== undefined) return fromTree;
  const named = own.filter((one) => one.type === kind && plain(one.name) === wanted);
  return named.length === 1 ? named[0].id : null;
}
