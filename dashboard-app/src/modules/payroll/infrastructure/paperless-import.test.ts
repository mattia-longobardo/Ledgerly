import { describe, expect, it } from "vitest";
import { isMigratable, mapLegacyPayslip, type LegacyPayslip } from "./paperless-import";

function legacy(over: Partial<LegacyPayslip> = {}): LegacyPayslip {
  return {
    id: 42,
    month: "2026-08-01",
    isThirteenth: false,
    paperlessDocId: 142,
    status: "verified",
    rawExtraction: null,
    corrections: null,
    gross: "2500.00",
    net: "1800.00",
    taxes: "700.00",
    fundContribEmployee: "50.00",
    fundContribEmployer: "100.00",
    ferieBalance: "88.25",
    rolBalance: "12.00",
    ferieTaken: "16.00",
    rolTaken: "4.00",
    verifiedAt: new Date("2026-09-01T10:00:00Z"),
    ...over,
  };
}

describe("isMigratable", () => {
  it("takes verified rows", () => {
    expect(isMigratable(legacy())).toBe(true);
  });

  it("leaves discovered, parsed, rejected and superseded rows behind", () => {
    for (const status of ["discovered", "parsed", "rejected", "superseded"]) {
      expect(isMigratable(legacy({ status }))).toBe(false);
    }
  });
});

describe("mapLegacyPayslip", () => {
  it("builds a filename that carries the period, so titleMonth can read it back", () => {
    expect(mapLegacyPayslip(legacy()).fileName).toBe("Busta Paga Agosto 2026.pdf");
    expect(mapLegacyPayslip(legacy({ month: "2025-12-01", isThirteenth: true })).fileName).toBe("Tredicesima 2025.pdf");
  });

  it("turns each stored column into a high-confidence, manually-sourced field", () => {
    const mapped = mapLegacyPayslip(legacy());
    expect(mapped.extraction.fields.net).toEqual({ value: 1800, confidence: "high", rules: 1800, llm: null, note: "migrated from Paperless" });
    expect(mapped.extraction.fields.ferieBalance).toEqual({ value: 88.25, confidence: "high", rules: 88.25, llm: null, note: "migrated from Paperless" });
  });

  it("omits a column the legacy row never held, rather than writing a zero", () => {
    const mapped = mapLegacyPayslip(legacy({ gross: null, taxes: null }));
    expect(mapped.extraction.fields.gross).toBeUndefined();
    expect(mapped.extraction.fields.taxes).toBeUndefined();
    expect(Object.keys(mapped.extraction.fields)).not.toContain("permessiBalance");
  });

  it("maps the legacy column names onto the parser's own field codes", () => {
    const mapped = mapLegacyPayslip(legacy());
    expect(Object.keys(mapped.extraction.fields).sort()).toEqual(
      ["ferieBalance", "ferieTakenHours", "fundContribEmployee", "fundContribEmployer", "gross", "net", "rolBalance", "rolTakenHours", "taxes"].sort(),
    );
  });

  it("carries the period, the record kind and the verification stamp", () => {
    const mapped = mapLegacyPayslip(legacy());
    expect(mapped).toMatchObject({
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      kind: "ordinary",
      verifiedAt: new Date("2026-09-01T10:00:00Z"),
    });
    expect(mapLegacyPayslip(legacy({ month: "2025-12-01", isThirteenth: true })).kind).toBe("thirteenth");
  });

  it("records the provenance so a reconciliation can trace every row back", () => {
    expect(mapLegacyPayslip(legacy()).legacySource).toEqual({ provider: "paperless", documentId: 142, payslipId: 42 });
  });

  it("marks the extraction as migrated, never as parsed by the current engine", () => {
    const mapped = mapLegacyPayslip(legacy());
    expect(mapped.extraction.parserVersion).toBe("migration-paperless-1");
    expect(mapped.extraction.textSource).toBe("pdf");
    expect(mapped.extraction.checks).toEqual([
      { id: "migrated", label: "migration", passed: true, detail: "values carried over from the verified Paperless row" },
    ]);
  });
});
