import { describe, expect, it } from "vitest";
import type { PayslipField } from "@/lib/contracts";
import type { AuxField } from "@/lib/payroll/anchors";
import {
  combineField,
  crossValidate,
  median,
  type CrossValidateInput,
  type PayslipHistoryEntry,
} from "@/lib/payroll/confidence";
import type { FieldProvenance, RulesResult } from "@/lib/payroll/rules";

function rulesResult(
  fields: Partial<Record<PayslipField, number | null>>,
  aux: Partial<Record<AuxField, number | null>> = {},
  provenance: Partial<Record<PayslipField, FieldProvenance>> = {},
): RulesResult {
  return { fields, aux, provenance, degraded: [], errors: [] };
}

function input(overrides: Partial<CrossValidateInput> = {}): CrossValidateInput {
  return {
    rules: rulesResult({}),
    llmFields: {},
    textSource: "pdf",
    isThirteenth: false,
    month: "2026-08-01",
    history: [],
    ...overrides,
  };
}

const HISTORY: readonly PayslipHistoryEntry[] = [
  { month: "2026-05-01", net: 2000, ferieBalance: 30, rolBalance: 10 },
  { month: "2026-06-01", net: 2010, ferieBalance: 40, rolBalance: 11 },
  { month: "2026-07-01", net: 2020, ferieBalance: 45.33, rolBalance: 12 },
];

describe("combineField", () => {
  it("is high when both passes agree within the money tolerance", () => {
    expect(combineField(2035.8, 2035.8).confidence).toBe("high");
    expect(combineField(2035.8, 2035.81).confidence).toBe("high");
  });

  it("is low when the passes disagree, keeping both candidates", () => {
    const field = combineField(2035.8, 2053.8);
    expect(field.confidence).toBe("low");
    expect(field.rules).toBe(2035.8);
    expect(field.llm).toBe(2053.8);
    expect(field.value).toBe(2035.8);
    expect(field.note).toContain("2035,80");
    expect(field.note).toContain("2053,80");
  });

  it("is medium with a single source and low when both are null", () => {
    expect(combineField(2035.8, null).confidence).toBe("medium");
    expect(combineField(null, 2035.8).confidence).toBe("medium");
    expect(combineField(null, null).confidence).toBe("low");
  });
});

describe("median", () => {
  it("handles odd and even sample sizes", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("crossValidate demotions", () => {
  it("demotes column-association fields read from OCR only", () => {
    const pdf = crossValidate(
      input({ rules: rulesResult({ ferieBalance: 45.33 }), llmFields: { ferieBalance: 45.33 } }),
    );
    expect(pdf.fields.ferieBalance?.confidence).toBe("high");

    const ocr = crossValidate(
      input({
        textSource: "ocr",
        rules: rulesResult({ ferieBalance: 45.33 }),
        llmFields: { ferieBalance: 45.33 },
      }),
    );
    expect(ocr.fields.ferieBalance?.confidence).toBe("medium");
    expect(ocr.fields.ferieBalance?.note).toContain("OCR");
  });

  it("keeps a flattened grid low even when only the LLM produced a value", () => {
    const result = crossValidate(
      input({
        textSource: "ocr",
        rules: rulesResult(
          { ferieBalance: null },
          {},
          {
            ferieBalance: {
              anchor: "grid:residui",
              strategy: "grid-column",
              lineIndex: 30,
              line: "48,00 13,33 16,00 45,33 12,00 12,00",
              degraded: true,
              note: "grid flattened: 6 values under 12 headers - column not guessed",
            },
          },
        ),
        llmFields: { ferieBalance: 45.33 },
      }),
    );
    expect(result.fields.ferieBalance?.confidence).toBe("low");
    expect(result.fields.ferieBalance?.note).toContain("grid flattened");
  });
});

describe("sanity checks", () => {
  it("fires when netto + ritenute does not equal competenze", () => {
    const ok = crossValidate(
      input({
        rules: rulesResult({ net: 2035.8 }, { totaleCompetenze: 3000, totaleRitenute: 964.2 }),
        llmFields: { net: 2035.8 },
      }),
    );
    expect(ok.checks.find((c) => c.id === "netto_vs_competenze")?.passed).toBe(true);
    expect(ok.fields.net?.confidence).toBe("high");

    const bad = crossValidate(
      input({
        rules: rulesResult({ net: 2023.4 }, { totaleCompetenze: 3000, totaleRitenute: 964.2 }),
        llmFields: { net: 2023.4 },
      }),
    );
    const check = bad.checks.find((c) => c.id === "netto_vs_competenze");
    expect(check?.passed).toBe(false);
    expect(check?.detail).toBe("netto + ritenute ≠ competenze, off by €12,40");
    expect(bad.fields.net?.confidence).toBe("medium");
  });

  it("fires when the residual does not continue from the prior month", () => {
    const ok = crossValidate(
      input({
        history: HISTORY,
        rules: rulesResult({ ferieBalance: 42.66, ferieTakenHours: 16, rolBalance: 12 }),
        llmFields: { ferieBalance: 42.66, ferieTakenHours: 16, rolBalance: 12 },
      }),
    );
    expect(ok.checks.find((c) => c.id === "residual_continuity")?.passed).toBe(true);

    const dropped = crossValidate(
      input({
        history: HISTORY,
        rules: rulesResult({ ferieBalance: 5, ferieTakenHours: 16 }),
        llmFields: { ferieBalance: 5, ferieTakenHours: 16 },
      }),
    );
    const droppedCheck = dropped.checks.find((c) => c.id === "residual_continuity");
    expect(droppedCheck?.passed).toBe(false);
    expect(droppedCheck?.detail).toContain("only 16,00 h were used");
    expect(dropped.fields.ferieBalance?.confidence).toBe("medium");

    const jumped = crossValidate(
      input({
        history: HISTORY,
        rules: rulesResult({ rolBalance: 90 }),
        llmFields: { rolBalance: 90 },
      }),
    );
    expect(jumped.checks.find((c) => c.id === "residual_continuity")?.passed).toBe(false);
    expect(jumped.fields.rolBalance?.confidence).toBe("medium");
  });

  it("fires when net drifts outside the trailing-median band", () => {
    const ok = crossValidate(
      input({ history: HISTORY, rules: rulesResult({ net: 2035.8 }), llmFields: { net: 2035.8 } }),
    );
    expect(ok.checks.find((c) => c.id === "net_vs_median")?.passed).toBe(true);

    const drifted = crossValidate(
      input({ history: HISTORY, rules: rulesResult({ net: 4000 }), llmFields: { net: 4000 } }),
    );
    const check = drifted.checks.find((c) => c.id === "net_vs_median");
    expect(check?.passed).toBe(false);
    expect(check?.detail).toContain("above");
    expect(drifted.fields.net?.confidence).toBe("medium");
  });

  it("skips the median band for a tredicesima and skips checks it cannot compute", () => {
    const thirteenth = crossValidate(
      input({
        history: HISTORY,
        isThirteenth: true,
        rules: rulesResult({ net: 4000 }),
        llmFields: { net: 4000 },
      }),
    );
    expect(thirteenth.checks.find((c) => c.id === "net_vs_median")).toBeUndefined();
    expect(crossValidate(input()).checks).toEqual([]);
  });
});
