import { describe, expect, it } from "vitest";
import { readPdfText } from "@/modules/imports/pdf/text";
import {
  ENROLLMENT,
  EXPORT_AUGUST,
  EXPORT_EXOTIC,
  FIRST_QUARTER,
  POSITION_AUGUST,
  SECOND_QUARTER,
} from "../../../../tests/fixtures/cometa/samples";
import {
  twinOperationsHtml,
  twinOperationsXlsx,
  twinPositionPdf,
} from "../../../../tests/fixtures/cometa/twin";
import { parseCometaPosition } from "./cometa-position";
import { classify, competenceOf, italianCents, OperationsParseError } from "./cometa-operations";
import { parseCometaOperations } from "./export";

const parse = (operations = EXPORT_AUGUST) => parseCometaOperations(twinOperationsHtml(operations));

describe("the operations export (GC §8.4, §11)", () => {
  it("reads the columns by their header, in any order", () => {
    const { operations } = parse([FIRST_QUARTER]);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      originalType: "Contributo",
      originalState: "QUOTATO",
      operationDate: "2031-04-18",
      competenceYear: 2031,
      competenceQuarter: 1,
      workerCents: 7_500n,
      employerCents: 13_500n,
      tfrCents: 45_000n,
      feesCents: 300n,
      netCents: 65_700n,
      classification: "contribution",
      employerTaxCode: "01234567890",
    });
    expect(operations[0].movements).toEqual([
      { row: 1, compartment: "CRESCITA", units: "30.000", unitPrice: "21.900", unitPriceDate: "2031-04-30" },
    ]);
  });

  it("makes one operation of a quarter split over two compartments, its amounts counted once", () => {
    const [operation] = parse([SECOND_QUARTER]).operations;
    expect(operation.workerCents).toBe(2_500n);
    expect(operation.netCents).toBe(21_700n);
    expect(operation.movements.map((movement) => movement.compartment)).toEqual(["CRESCITA", "SICUREZZA"]);
  });

  it("calls an enrolment an enrolment, though the export says 'Contributo' (GC §8.4)", () => {
    const [operation] = parse([ENROLLMENT]).operations;
    expect(operation).toMatchObject({ classification: "enrollment", netCents: 0n, feesCents: 1_032n });
    expect(operation.originalType).toBe("Contributo");
  });

  it("tells transfers, switches, withdrawals and voluntary payments apart (GC §13)", () => {
    const classes = parse(EXPORT_EXOTIC).operations.map((operation) => operation.classification);
    expect(classes).toEqual(["transfer_in", "switch", "withdrawal", "voluntary"]);
  });

  it("gives the same operation the same key in two exports, and two identical rows two keys", () => {
    const first = parse([FIRST_QUARTER, ENROLLMENT]).operations;
    const second = parse([SECOND_QUARTER, FIRST_QUARTER, ENROLLMENT]).operations;
    const keyOf = (rows: typeof first, quarter: number, type: string) =>
      rows.find((operation) => operation.competenceQuarter === quarter && operation.classification === type)!
        .originKey;
    expect(keyOf(first, 1, "contribution")).toBe(keyOf(second, 1, "contribution"));
    expect(keyOf(first, 1, "enrollment")).toBe(keyOf(second, 1, "enrollment"));
    const twice = parse([FIRST_QUARTER, FIRST_QUARTER]).operations;
    expect(twice).toHaveLength(2);
    expect(twice[0].originKey).not.toBe(twice[1].originKey);
    expect(twice[1].originKey.endsWith("#2")).toBe(true);
  });

  it("keeps the same key when a later export adds the quotation", () => {
    const pending = { ...FIRST_QUARTER, state: "IN LAVORAZIONE", movements: [] };
    const [waiting] = parse([pending]).operations;
    const [quoted] = parse([FIRST_QUARTER]).operations;
    expect(waiting.originKey).toBe(quoted.originKey);
    expect(waiting.movements).toEqual([]);
  });

  it("reads the same table from an XLSX", () => {
    const { operations } = parseCometaOperations(twinOperationsXlsx(EXPORT_AUGUST));
    expect(operations.map((operation) => operation.netCents)).toEqual([21_700n, 65_700n, 0n]);
    expect(operations[0].movements).toHaveLength(2);
    expect(operations[1].operationDate).toBe("2031-04-18");
  });

  it("says 'not this export' when the file is somebody else's spreadsheet", () => {
    // The owner's own net-worth allocation sheet, uploaded by mistake: it is a perfectly good
    // spreadsheet, so the answer must be "wrong file", not "broken file".
    const allocation = twinOperationsXlsx([]);
    const sheet = new TextEncoder().encode(
      "<html><body><table><tr><th>Date</th><th>ING</th><th>TOTAL</th></tr><tr><td>01/01/2031</td><td>1,00</td><td>1,00</td></tr></table></body></html>",
    );
    expect(() => parseCometaOperations(sheet)).toThrowError(
      expect.objectContaining({ code: "not_an_export" }) as unknown as Error,
    );
    expect(allocation.length).toBeGreaterThan(0);
  });

  it("refuses a binary XLS and a file with no table", () => {
    const ole2 = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    expect(() => parseCometaOperations(ole2)).toThrowError(
      expect.objectContaining({ code: "binary_xls" }) as unknown as Error,
    );
    expect(() =>
      parseCometaOperations(new TextEncoder().encode("<html><table><tr><td>x</td></tr></table>")),
    ).toThrow(OperationsParseError);
  });

  it("reads Italian numbers and quarters, and refuses what it cannot read", () => {
    expect(italianCents("1.234,56", "x")).toBe(123_456n);
    expect(italianCents("-3,00", "x")).toBe(-300n);
    expect(italianCents("", "x")).toBe(0n);
    expect(() => italianCents("12.3", "x")).toThrow(OperationsParseError);
    expect(competenceOf("2026 SECONDO")).toEqual({ year: 2026, quarter: 2 });
    expect(competenceOf("2025 QUARTO")).toEqual({ year: 2025, quarter: 4 });
    expect(competenceOf("IV 2025")).toEqual({ year: 2025, quarter: 4 });
    expect(competenceOf("2025")).toBeNull();
  });

  it("only calls a contribution an enrolment when nothing was invested", () => {
    expect(classify("Contributo", { gross: 1_032n, fees: 1_032n, net: 0n }, ["0.000"])).toBe("enrollment");
    expect(classify("Contributo", { gross: 1_032n, fees: 300n, net: 732n }, ["1.000"])).toBe("contribution");
  });
});

describe("the position summary (GC §8.5)", () => {
  it("reads every label with its box, and the value with its date", async () => {
    const parsed = parseCometaPosition(await readPdfText(await twinPositionPdf(POSITION_AUGUST)));
    const value = (field: string) => parsed.fields.find((one) => one.field === field);
    expect(value("valuationDate")).toMatchObject({ value: "2031-08-31", origin: "printed", page: 1 });
    expect(value("value")).toMatchObject({ value: "950.00" });
    expect(value("tfr")).toMatchObject({ value: "600.00", sourceLabel: "TFR" });
    expect(value("worker")).toMatchObject({ value: "105.16" });
    expect(value("employer")).toMatchObject({ value: "185.16" });
    expect(value("inflows")).toMatchObject({ value: "890.32" });
    expect(value("outflows")).toMatchObject({ value: "0.00" });
    expect(value("rita")).toMatchObject({ value: "0.00" });
    expect(value("reportedGain")).toMatchObject({ value: "59.68" });
    const box = value("tfr")!.bbox!;
    expect(box.every((one) => one >= 0 && one <= 1)).toBe(true);
    expect(box[0]).toBeLessThan(box[2]);
  });

  it("leaves a field it cannot find null, with no confidence", async () => {
    const parsed = parseCometaPosition([{ page: 1, width: 595, height: 842, items: [] }]);
    expect(parsed.fields.every((field) => field.value === null && field.confidence === 0)).toBe(true);
  });
});
