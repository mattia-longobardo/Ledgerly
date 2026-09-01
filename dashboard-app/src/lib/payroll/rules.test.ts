import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { detectPeriodMonth, numbersOnLine, readGrid, runRules } from "@/lib/payroll/rules";
import { normalizeText, splitLines } from "@/lib/payroll/text";

function fixture(name: string): string {
  return normalizeText(
    readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), "utf8"),
  );
}

const PDF_TEXT = fixture("august-2026.pdf.txt");
const OCR_TEXT = fixture("august-2026.ocr.txt");
const GARBAGE_TEXT = fixture("garbage.ocr.txt");

describe("numbersOnLine", () => {
  it("reads Italian amounts and ignores dates, codes and text", () => {
    expect(numbersOnLine("NETTO BUSTA 2.035,80").map((h) => h.value)).toEqual([2035.8]);
    expect(numbersOnLine("PERIODO 31/08/2026 AGOSTO").map((h) => h.value)).toEqual([]);
    expect(numbersOnLine("500 FONDO C/DIPE 1,24 37,20").map((h) => h.value)).toEqual([500, 1.24, 37.2]);
  });

  it("reads the trailing minus payroll printings use", () => {
    expect(numbersOnLine("ARROTONDAMENTO 0,10-").map((h) => h.value)).toEqual([-0.1]);
  });
});

describe("runRules on clean PDF text", () => {
  const result = runRules(PDF_TEXT);

  it("extracts every money field from its anchor", () => {
    expect(result.fields.gross).toBe(3000);
    expect(result.fields.net).toBe(2035.8);
    expect(result.fields.fundContribEmployee).toBe(37.2);
    expect(result.fields.fundContribEmployer).toBe(46.5);
  });

  it("composes taxes from IRPEF plus both addizionali", () => {
    expect(result.aux.irpefTrattenute).toBe(580);
    expect(result.aux.addizionaleRegionale).toBe(45.3);
    expect(result.aux.addizionaleComunale).toBe(18.2);
    expect(result.fields.taxes).toBe(643.5);
  });

  it("reads the leave grid by column", () => {
    expect(result.fields.ferieBalance).toBe(45.33);
    expect(result.fields.permessiBalance).toBe(12);
    expect(result.fields.rolBalance).toBe(12);
  });

  it("leaves hours-taken to the TeamSystem reader", () => {
    // `FERIE GOD.` has no adjacent label, so the generic anchor engine cannot
    // reach it; anchoring body row 300 here instead made the two passes
    // disagree on every month with leave taken (12,01 vs 8,00 in August) and
    // dropped the field to low confidence. `teamsystem.ts` reads the grid.
    expect(result.fields.ferieTakenHours ?? null).toBeNull();
  });

  it("records provenance for the human verification screen", () => {
    expect(result.provenance.net?.anchor).toBe("NETTO BUSTA");
    expect(result.provenance.net?.line).toContain("2.035,80");
    expect(result.provenance.ferieBalance?.strategy).toBe("grid-column");
    expect(result.degraded).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("also carries the aux figures the sanity checks need", () => {
    expect(result.aux.totaleCompetenze).toBe(3000);
    expect(result.aux.totaleRitenute).toBe(964.2);
  });
});

describe("runRules on degraded OCR text", () => {
  const result = runRules(OCR_TEXT);

  it("still reads the label-anchored fields after OCR repair", () => {
    expect(result.fields.net).toBe(2035.8);
    expect(result.fields.gross).toBe(3000);
    expect(result.fields.taxes).toBe(643.5);
  });

  it("refuses to guess a column when the grid is flattened", () => {
    const reading = readGrid(splitLines(OCR_TEXT), "residui");
    expect(reading.values).toHaveLength(6);
    expect(reading.headerCount).toBe(12);

    expect(result.fields.ferieBalance).toBeNull();
    expect(result.fields.rolBalance).toBeNull();
    expect(result.fields.permessiBalance).toBeNull();
    expect(result.degraded).toEqual(["ferieBalance", "rolBalance", "permessiBalance"]);
    expect(result.provenance.ferieBalance?.note).toContain("6 values under 12 headers");
  });
});

describe("runRules on garbage", () => {
  it("returns nulls without throwing", () => {
    const result = runRules(GARBAGE_TEXT);
    expect(result.fields.net).toBeNull();
    expect(result.fields.gross).toBeNull();
    expect(result.errors).toEqual([]);
  });
});

describe("detectPeriodMonth", () => {
  it("reads the Italian period header", () => {
    expect(detectPeriodMonth(PDF_TEXT)).toBe("2026-08-01");
    expect(detectPeriodMonth(fixture("december-2026-tredicesima.txt"))).toBe("2026-12-01");
  });

  it("falls back to a numeric period and gives up cleanly", () => {
    expect(detectPeriodMonth("PERIODO DI PAGA 03/2026")).toBe("2026-03-01");
    expect(detectPeriodMonth(GARBAGE_TEXT)).toBeNull();
  });
});
