import { describe, expect, it } from "vitest";
import { csvMapSchema } from "@ledgerly/api-contract";
import { type CsvMap, csvRows, decodeText, detectDelimiter, parseRecords, proposeMap } from "./rules/csv";
import { detectDateFormat, detectDecimal, parseAmountCell, parseDateCell } from "./rules/csv/values";

// The import of a CSV file, its pure part (decision ST-8): the records of RFC 4180, the values in
// the formats of the banks, the map a file proposes, and the rows as movements with their keys.

const ACCOUNT = "1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9";
const TODAY = "2026-11-23";

const MAP: CsvMap = {
  columns: { date: 0, amount: 2, debit: null, credit: null, payee: 1, note: null, category: null },
  delimiter: ";",
  decimalSeparator: ",",
  dateFormat: "DD/MM/YYYY",
  skipRows: 0,
  header: true,
};

const rowsOf = (text: string, map: CsvMap = MAP) =>
  csvRows(parseRecords(text, map.delimiter), map, { accountId: ACCOUNT, today: TODAY });

describe("the records of a file", () => {
  it("reads quotes, a quote written twice, the delimiter and a line break inside quotes", () => {
    expect(parseRecords('a;"b;c";"say ""hi"""\r\n"two\nlines";x;\r\n', ";")).toEqual([
      ["a", "b;c", 'say "hi"'],
      ["two\nlines", "x", ""],
    ]);
  });

  it("ends a record at CRLF, LF or CR, and keeps the last one without a line break", () => {
    expect(parseRecords("a,b\rc,d\ne,f", ",")).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e", "f"],
    ]);
  });

  it("reads UTF-8 without its BOM, and Windows-1252 when the bytes are not UTF-8", () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0xc3, 0xa8]))).toBe("aè");
    expect(decodeText(new Uint8Array([0x63, 0x61, 0x66, 0xe8, 0x80]))).toBe("cafè€");
  });

  it("finds the delimiter that splits the rows in the same number of columns", () => {
    expect(detectDelimiter("Data;Importo;Note\n01/02/2026;-1,50;a, b\n")).toBe(";");
    expect(detectDelimiter('date,amount,payee\n2026-02-01,-1.50,"Shop; Inc"\n')).toBe(",");
    expect(detectDelimiter("date\tamount\n2026-02-01\t-1.50\n")).toBe("\t");
  });
});

describe("the values of a cell", () => {
  it("reads an amount in cents with a decimal comma or point and thousands separators", () => {
    expect(parseAmountCell("1.234,56", ",")).toBe(123456n);
    expect(parseAmountCell("1,234.56", ".")).toBe(123456n);
    expect(parseAmountCell("€ 1 234,5", ",")).toBe(123450n);
    expect(parseAmountCell("+12", ",")).toBe(1200n);
    // A number a float cannot hold exactly stays exact.
    expect(parseAmountCell("90071992547409.93", ".")).toBe(9007199254740993n);
  });

  it("reads money out as a minus before or after, or in parentheses", () => {
    expect(parseAmountCell("-42,80", ",")).toBe(-4280n);
    expect(parseAmountCell("42,80-", ",")).toBe(-4280n);
    expect(parseAmountCell("(42,80)", ",")).toBe(-4280n);
  });

  it("refuses what is not an amount, and thousands written wrong", () => {
    for (const text of ["", "abc", "12,5,0", "1.23,4.5", "12.50"])
      expect(parseAmountCell(text, ",")).toBeNull();
  });

  it("reads a day in a format, and refuses a day that does not exist", () => {
    expect(parseDateCell("14/10/2026", "DD/MM/YYYY")).toBe("2026-10-14");
    expect(parseDateCell("2026-10-14T10:22:00", "YYYY-MM-DD")).toBe("2026-10-14");
    expect(parseDateCell("1.2.2026 08:00", "DD.MM.YYYY")).toBe("2026-02-01");
    expect(parseDateCell("10/14/2026", "MM/DD/YYYY")).toBe("2026-10-14");
    expect(parseDateCell("31/02/2026", "DD/MM/YYYY")).toBeNull();
    expect(parseDateCell("14/10/26", "DD/MM/YYYY")).toBeNull();
  });

  it("finds the format and the decimal separator from the samples", () => {
    expect(detectDateFormat(["14/10/2026", "01/02/2026"])).toBe("DD/MM/YYYY");
    expect(detectDateFormat(["10/14/2026"])).toBe("MM/DD/YYYY");
    expect(detectDateFormat(["2026-10-14"])).toBe("YYYY-MM-DD");
    expect(detectDateFormat(["soon"])).toBeNull();
    expect(detectDecimal(["-42,80", "1.000,00"])).toBe(",");
    expect(detectDecimal(["-42.80", "1,000.00"])).toBe(".");
  });
});

describe("the map", () => {
  it("is one amount column or a debit and a credit column, and a date format of DD, MM, YYYY", () => {
    expect(csvMapSchema.safeParse(MAP).success).toBe(true);
    const both = { ...MAP, columns: { ...MAP.columns, debit: 3 } };
    expect(csvMapSchema.safeParse(both).success).toBe(false);
    const none = { ...MAP, columns: { ...MAP.columns, amount: null } };
    expect(csvMapSchema.safeParse(none).success).toBe(false);
    expect(csvMapSchema.safeParse({ ...MAP, dateFormat: "DD/DD/YYYY" }).success).toBe(false);
    expect(csvMapSchema.safeParse({ ...MAP, dateFormat: "YYYY.MM.DD" }).success).toBe(true);
    expect(csvMapSchema.safeParse({ ...MAP, delimiter: '"' }).success).toBe(false);
    expect(csvMapSchema.safeParse({ ...MAP, delimiter: "\t" }).success).toBe(true);
  });

  it("is proposed from the header's names, debit and credit included", () => {
    const records = parseRecords(
      "Data Operazione;Data Valuta;Entrate;Uscite;Descrizione\n14/10/2026;15/10/2026;;-42,80;Corner shop\n",
      ";",
    );
    expect(proposeMap(records, ";")).toEqual({
      columns: { date: 0, amount: null, debit: 3, credit: 2, payee: 4, note: null, category: null },
      delimiter: ";",
      decimalSeparator: ",",
      dateFormat: "DD/MM/YYYY",
      skipRows: 0,
      header: true,
    });
  });

  it("is proposed from the values of a file with no header", () => {
    const records = parseRecords("\n2026-10-14,-42.80,Corner shop\n2026-10-15,1200.00,Salary\n", ",");
    expect(proposeMap(records, ",")).toEqual({
      columns: { date: 0, amount: 1, debit: null, credit: null, payee: 2, note: null, category: null },
      delimiter: ",",
      decimalSeparator: ".",
      dateFormat: "YYYY-MM-DD",
      skipRows: 1,
      header: false,
    });
  });

  it("is not proposed for a file with no day or no amount", () => {
    expect(proposeMap(parseRecords("name;city\nAda;Turin\n", ";"), ";")).toBeNull();
  });
});

describe("the rows as movements", () => {
  it("numbers the rows as a spreadsheet does, and gives each a movement or a code", () => {
    const rows = rowsOf(
      [
        "Data;Descrizione;Importo",
        "14/10/2026;Corner shop;-42,80",
        "",
        "15/10/2026;Salary;1.200,00",
        "32/10/2026;Bad day;-1,00",
        "16/10/2026;Bad amount;abc",
        "17/10/2026;No amount;",
        "18/10/2026;Zero;0,00",
        "24/11/2026;Tomorrow;-1,00",
        "19/10/2026",
      ].join("\r\n"),
    );
    expect(
      rows.map((row) => ("reason" in row ? [row.row, row.reason] : [row.row, row.movement.kind])),
    ).toEqual([
      [2, "expense"],
      [4, "income"],
      [5, "bad_date"],
      [6, "bad_amount"],
      [7, "no_amount"],
      [8, "zero_amount"],
      [9, "future_date"],
      [10, "no_amount"],
    ]);
    expect(rows[0]).toMatchObject({
      movement: { amountCents: 4280n, on: "2026-10-14", payee: "Corner shop", note: null, category: null },
    });
  });

  it("reads a debit column as money out and a credit column as money in, whatever their sign", () => {
    const map: CsvMap = { ...MAP, columns: { ...MAP.columns, amount: null, debit: 2, credit: 3 } };
    const rows = rowsOf("h\n14/10/2026;Shop;-42,80;\n15/10/2026;Pay;;1200\n16/10/2026;Both;10;12\n", map);
    expect(
      rows.map((row) => ("movement" in row ? [row.movement.kind, row.movement.amountCents] : row)),
    ).toEqual([
      ["expense", 4280n],
      ["income", 120000n],
      ["income", 200n],
    ]);
  });

  it("skips the rows before the header, and a file with no header reads from its first row", () => {
    const skipped = rowsOf("Bank export\nAccount 1\nData;Descrizione;Importo\n14/10/2026;Shop;-1\n", {
      ...MAP,
      skipRows: 2,
    });
    expect(skipped).toEqual([expect.objectContaining({ row: 4 })]);
    expect(rowsOf("14/10/2026;Shop;-1\n", { ...MAP, header: false })).toEqual([
      expect.objectContaining({ row: 1 }),
    ]);
  });

  it("gives the same file the same keys, and two identical rows of one file two keys", () => {
    const file =
      "Data;Descrizione;Importo\n14/10/2026;Bar;-1,50\n14/10/2026;BAR ;-1,50\n14/10/2026;Bar;-2,00\n";
    const keys = (text: string) =>
      rowsOf(text).map((row) => ("movement" in row ? row.movement.key : row.reason));
    const first = keys(file);
    expect(first.every((key) => /^csv:[0-9a-f]{64}$/.test(key))).toBe(true);
    expect(new Set(first).size).toBe(3);
    expect(keys(file)).toEqual(first);
    // The second identical row of a later file is the second of the first file: the same key.
    expect(keys("Data;Descrizione;Importo\n14/10/2026;bar;-1,50\n")).toEqual([first[0]]);
    const other = csvRows(parseRecords(file, ";"), MAP, { accountId: crypto.randomUUID(), today: TODAY });
    expect(other.map((row) => ("movement" in row ? row.movement.key : ""))).not.toContain(first[0]);
  });

  it("cuts a payee and a note to the lengths of a manual movement", () => {
    const map: CsvMap = { ...MAP, columns: { ...MAP.columns, note: 3, category: 4 } };
    const [row] = rowsOf(`h\n14/10/2026;${"p".repeat(300)};-1;${"n".repeat(2100)}; Food \n`, map);
    expect(
      "movement" in row && [row.movement.payee?.length, row.movement.note?.length, row.movement.category],
    ).toEqual([255, 2000, "Food"]);
  });
});
