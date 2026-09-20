import { createHash } from "node:crypto";
import { type CivilDate, isCivilDate } from "@/platform/dates";
import { type Cents, parseCents } from "@/platform/money";
import { isQuarter, type OperationClass, type Quarter } from "../pension/rules";

/**
 * Cometa's "Dettaglio operazioni" export (spec §7.7, §9.3; GC §8.4, §10–11), read as data: never an
 * instruction. The real export is an HTML table saved as `.xls`: one `<tbody>` per operation, one
 * row per unit movement, the operation's amounts repeated on every row. Columns are found by the
 * name of their header, never by position; numbers are Italian; "2026 SECONDO" is year and quarter.
 */

export const OPERATIONS_PARSER_VERSION = "cometa-operations@1";

export type OperationsErrorCode =
  | "no_table"
  /** The file was read, and it is a table or a sheet — just not this export (plan F6 §3.6.10). */
  | "not_an_export"
  | "missing_columns"
  | "bad_value"
  | "binary_xls";

export class OperationsParseError extends Error {
  constructor(
    readonly code: OperationsErrorCode,
    readonly detail: string | null = null,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "OperationsParseError";
  }
}

const COLUMNS = {
  type: "tipooperazione",
  state: "statooperazione",
  date: "dataoperazione",
  quarter: "trimestrecomp",
  employerTaxCode: "codfiscazienda",
  employerName: "denominazioneazienda",
  worker: "importolordoaderente",
  employer: "importolordoazienda",
  tfr: "tfr",
  other: "altro",
  fees: "quotaspese",
  net: "importonettospese",
  compartment: "comparto",
  units: "numeroquote",
  unitPrice: "valorequota",
  unitPriceDate: "datavalorequota",
} as const;
type Column = keyof typeof COLUMNS;

const REQUIRED: readonly Column[] = ["type", "date", "worker", "employer", "tfr", "fees", "net"];

/** A header as compared: lower case, letters and digits only ("Importo Netto Spese*" → "importonettospese"). */
export function headerKey(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** A table as read: its header cells and its body rows, each row tagged with its group (`tbody`). */
export interface RawTable {
  header: string[];
  rows: { cells: string[]; group: number | null }[];
}

export interface ParsedMovement {
  /** 1-based row of the table body the movement was read from. */
  row: number;
  compartment: string;
  /** Decimal text as printed, dot-separated ("30.427"); never more precision than printed (GC §13). */
  units: string;
  unitPrice: string | null;
  unitPriceDate: CivilDate | null;
}

export interface ParsedOperation {
  rows: number[];
  originalType: string;
  originalState: string | null;
  operationDate: CivilDate;
  competenceYear: number | null;
  competenceQuarter: Quarter | null;
  /** The quarter as printed ("2026 SECONDO"). */
  competenceText: string | null;
  workerCents: Cents;
  employerCents: Cents;
  tfrCents: Cents;
  otherCents: Cents;
  feesCents: Cents;
  netCents: Cents;
  employerTaxCode: string | null;
  employerName: string | null;
  classification: OperationClass;
  /** What deduplicates overlapping exports: the fingerprint and its occurrence in this export. */
  originKey: string;
  movements: ParsedMovement[];
}

export interface ParsedExport {
  operations: ParsedOperation[];
  /** The raw table, for the evidence (row and cell) and the preview. */
  table: RawTable;
  columns: Partial<Record<Column, number>>;
}

// ——— Reading the table out of the file ———

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** A cell's text: tags and comments out, entities decoded, blanks collapsed. */
function cellText(html: string): string {
  return decodeEntities(html.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function cellsOf(rowHtml: string, tag: "td" | "th" | "t[dh]"): string[] {
  const cells: string[] = [];
  for (const match of rowHtml.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}\\s*>`, "gi"))) {
    cells.push(cellText(match[1]));
  }
  return cells;
}

/**
 * The first table whose header names the operation type, from the HTML: header cells from its
 * `<thead>` (or first row), body rows grouped by the `<tbody>` they sit in.
 */
export function tableFromHtml(html: string): RawTable {
  const source = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const match of source.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table\s*>/gi)) {
    const inner = match[1];
    const head = /<thead\b[^>]*>([\s\S]*?)<\/thead\s*>/i.exec(inner);
    const rowsHtml = [...inner.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)];
    let header = head ? cellsOf(head[1], "t[dh]") : [];
    if (header.length === 0 && rowsHtml.length > 0) header = cellsOf(rowsHtml[0][1], "t[dh]");
    if (!header.map(headerKey).includes(COLUMNS.type)) continue;

    const body = head ? inner.replace(head[0], "") : inner;
    const rows: RawTable["rows"] = [];
    const bodies = [...body.matchAll(/<tbody\b[^>]*>([\s\S]*?)<\/tbody\s*>/gi)];
    if (bodies.length > 0) {
      bodies.forEach((tbody, group) => {
        for (const tr of tbody[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)) {
          const cells = cellsOf(tr[1], "td");
          if (cells.length > 0) rows.push({ cells, group });
        }
      });
    } else {
      for (const tr of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)) {
        const cells = cellsOf(tr[1], "td");
        if (cells.length > 0 && headerKey(cells[0]) !== COLUMNS.type) rows.push({ cells, group: null });
      }
    }
    return { header, rows };
  }
  // A page with tables, none of which is the export: worth saying apart from "no table at all",
  // because the answer is "you sent the wrong file", not "the file is broken".
  const tables = [...source.matchAll(/<table\b/gi)].length;
  throw new OperationsParseError(tables > 0 ? "not_an_export" : "no_table");
}

// ——— Values ———

/** "1.234,56" → cents; "-3,00" keeps its sign; blank → 0 (the export prints zeros as "0,00"). */
export function italianCents(text: string, column: string): Cents {
  const clean = text.replace(/[\s€]/g, "");
  if (clean === "") return 0n;
  if (!/^[-+]?\d{1,3}(\.\d{3})*(,\d+)?$|^[-+]?\d+(,\d+)?$/.test(clean)) {
    throw new OperationsParseError("bad_value", column);
  }
  const plain = clean.replaceAll(".", "").replace(",", ".");
  const [whole, fraction = ""] = plain.split(".");
  if (fraction.length > 2 && /[1-9]/.test(fraction.slice(2)))
    throw new OperationsParseError("bad_value", column);
  return parseCents(`${whole}.${fraction.slice(0, 2).padEnd(2, "0")}`);
}

/** "30,427" → "30.427", as printed: no digit added or dropped. */
export function italianDecimal(text: string, column: string): string {
  const clean = text.replace(/\s/g, "");
  if (!/^[-+]?\d{1,3}(\.\d{3})*(,\d+)?$|^[-+]?\d+(,\d+)?$/.test(clean)) {
    throw new OperationsParseError("bad_value", column);
  }
  return clean.replace(/^\+/, "").replaceAll(".", "").replace(",", ".");
}

/** "16/07/2026" → "2026-07-16". */
export function italianDate(text: string, column: string): CivilDate {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  const date = match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : "";
  if (!isCivilDate(date)) throw new OperationsParseError("bad_value", column);
  return date;
}

const QUARTER_WORDS: Record<string, Quarter> = {
  primo: 1,
  secondo: 2,
  terzo: 3,
  quarto: 4,
  i: 1,
  ii: 2,
  iii: 3,
  iv: 4,
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
};

/** "2026 SECONDO" → 2026, II (also "2026 II", "II 2026", "2026 Q2"). */
export function competenceOf(text: string): { year: number; quarter: Quarter } | null {
  const words = text
    .toLowerCase()
    .replace(/trimestre/g, " ")
    .split(/[\s/-]+/)
    .filter(Boolean);
  const year = words.find((word) => /^\d{4}$/.test(word));
  const other = words.find((word) => word !== year);
  const quarter = other ? QUARTER_WORDS[/^q\d$/.test(other) ? other.slice(1) : other] : undefined;
  if (!year || quarter === undefined || !isQuarter(quarter)) return null;
  return { year: Number(year), quarter };
}

// ——— Interpretation (GC §8.4) ———

/**
 * The interpreted class beside the original description. Cometa calls the enrolment fee
 * "Contributo" too: a contribution with a net of zero, no units bought and fees equal to its gross
 * is the enrolment (GC §8.4). Transfers in are capital from elsewhere, switches are internal
 * movements, withdrawals leave the position (GC §9.3) — none of them is a contribution.
 */
export function classify(
  originalType: string,
  amounts: { gross: Cents; fees: Cents; net: Cents },
  units: readonly string[],
): OperationClass {
  const type = originalType.toLowerCase();
  if (/switch|cambio\s*compart|riallocaz|conversione/.test(type)) return "switch";
  if (/riscatt|anticipaz|r\.?i\.?t\.?a|prestazion|liquidaz|rendita/.test(type)) return "withdrawal";
  if (/trasferiment/.test(type))
    return /uscita|\bout\b|in\s*uscita|verso/.test(type) ? "withdrawal" : "transfer_in";
  if (/volontar|aggiuntiv|diretto/.test(type)) return "voluntary";
  if (/contribut|versament/.test(type)) {
    const noUnits = units.every((value) => Number(value) === 0);
    return amounts.net === 0n && noUnits && amounts.fees > 0n && amounts.fees === amounts.gross
      ? "enrollment"
      : "contribution";
  }
  return "other";
}

function fingerprint(parts: readonly (string | null)[]): string {
  return createHash("sha256")
    .update(parts.map((part) => part ?? "").join("\u001f"))
    .digest("hex")
    .slice(0, 32);
}

/**
 * The table as operations (GC §10): rows of one `<tbody>` — or, without groups, consecutive rows
 * with the same header over different compartments — are one operation with several unit
 * movements, its amounts counted once. An identical operation twice in the same export is two
 * operations (`#2`); the same one in another export has the same key and is recognised.
 *
 * The key leaves the state, the compartments, the units and the prices out (a deviation from plan
 * §3.4.4, which named them): an export taken before the quotation carries none of them, and the
 * export taken after it must update that operation rather than add a second one. What is left —
 * type, date, competence, amounts, employer — is what the guide asks to compare (GC §11.6), and two
 * genuinely identical rows of one export are still two operations through their occurrence number.
 */
export function operationsOf(table: RawTable): ParsedExport {
  const keys = table.header.map(headerKey);
  const columns: Partial<Record<Column, number>> = {};
  for (const [name, key] of Object.entries(COLUMNS) as [Column, string][]) {
    const index = keys.indexOf(key);
    if (index >= 0) columns[name] = index;
  }
  const missing = REQUIRED.filter((name) => columns[name] === undefined);
  if (missing.length > 0) throw new OperationsParseError("missing_columns", missing.join(","));

  const cell = (cells: string[], name: Column) => {
    const index = columns[name];
    return index === undefined ? "" : (cells[index] ?? "").trim();
  };

  interface Group {
    rows: number[];
    cells: string[];
    headerKey: string;
    group: number | null;
    compartments: Set<string>;
  }
  const groups: Group[] = [];
  table.rows.forEach(({ cells, group }, index) => {
    const header = (
      [
        "type",
        "date",
        "quarter",
        "employerTaxCode",
        "worker",
        "employer",
        "tfr",
        "other",
        "fees",
        "net",
      ] as Column[]
    )
      .map((name) => cell(cells, name))
      .join("|");
    const compartment = cell(cells, "compartment");
    const last = groups.at(-1);
    const joins =
      last !== undefined &&
      (group !== null
        ? last.group === group
        : last.headerKey === header && compartment !== "" && !last.compartments.has(compartment));
    if (joins) {
      last.rows.push(index + 1);
      last.compartments.add(compartment);
    } else {
      groups.push({
        rows: [index + 1],
        cells,
        headerKey: header,
        group,
        compartments: new Set([compartment]),
      });
    }
  });

  const seen = new Map<string, number>();
  const operations = groups.map((group): ParsedOperation => {
    const { cells } = group;
    const originalType = cell(cells, "type");
    const worker = italianCents(cell(cells, "worker"), "worker");
    const employer = italianCents(cell(cells, "employer"), "employer");
    const tfr = italianCents(cell(cells, "tfr"), "tfr");
    const other = italianCents(cell(cells, "other"), "other");
    const fees = italianCents(cell(cells, "fees"), "fees");
    const net = italianCents(cell(cells, "net"), "net");
    const competenceText = cell(cells, "quarter") || null;
    const competence = competenceText ? competenceOf(competenceText) : null;
    const movements = group.rows.flatMap((row): ParsedMovement[] => {
      const rowCells = table.rows[row - 1].cells;
      const compartment = cell(rowCells, "compartment");
      const unitsText = cell(rowCells, "units");
      if (compartment === "" && unitsText === "") return [];
      const priceText = cell(rowCells, "unitPrice");
      const priceDate = cell(rowCells, "unitPriceDate");
      return [
        {
          row,
          compartment: compartment || "—",
          units: unitsText === "" ? "0" : italianDecimal(unitsText, "units"),
          unitPrice: priceText === "" ? null : italianDecimal(priceText, "unitPrice"),
          unitPriceDate: priceDate === "" ? null : italianDate(priceDate, "unitPriceDate"),
        },
      ];
    });
    const operationDate = italianDate(cell(cells, "date"), "date");
    const employerTaxCode = cell(cells, "employerTaxCode") || null;
    const print = fingerprint([
      originalType.toLowerCase(),
      operationDate,
      competence ? `${competence.year}-${competence.quarter}` : competenceText,
      ...[worker, employer, tfr, other, fees, net].map(String),
      employerTaxCode,
    ]);
    const occurrence = (seen.get(print) ?? 0) + 1;
    seen.set(print, occurrence);
    return {
      rows: group.rows,
      originalType,
      originalState: cell(cells, "state") || null,
      operationDate,
      competenceYear: competence?.year ?? null,
      competenceQuarter: competence?.quarter ?? null,
      competenceText,
      workerCents: worker,
      employerCents: employer,
      tfrCents: tfr,
      otherCents: other,
      feesCents: fees,
      netCents: net,
      employerTaxCode,
      employerName: cell(cells, "employerName") || null,
      classification: classify(
        originalType,
        { gross: worker + employer + tfr + other, fees, net },
        movements.map((movement) => movement.units),
      ),
      originKey: `${print}#${occurrence}`,
      movements,
    };
  });
  return { operations, table, columns };
}
