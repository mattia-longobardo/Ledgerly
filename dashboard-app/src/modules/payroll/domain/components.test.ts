import { describe, expect, it } from "vitest";
import type { PayslipExtraction } from "@/lib/contracts";
import type { PayrollMappingRule } from "../application/ports";
import { DEFAULT_MAPPING_RULES } from "./mapping";
import { componentsFromExtraction, grossOf, netOf } from "./components";

const rules: PayrollMappingRule[] = DEFAULT_MAPPING_RULES.map((r, i) => ({ ...r, id: `g${i}`, userId: null }));

function extraction(fields: PayslipExtraction["fields"]): PayslipExtraction {
  return {
    parserVersion: "payroll-1.0.0",
    month: "2026-08-01",
    isThirteenth: false,
    textSource: "pdf",
    fields,
    checks: [],
  };
}

describe("componentsFromExtraction", () => {
  it("emits one component per field the parser actually read, in PAYSLIP_FIELDS order", () => {
    const components = componentsFromExtraction(
      extraction({
        gross: { value: 2500, confidence: "high", rules: 2500, llm: 2500 },
        net: { value: 1800.5, confidence: "high", rules: 1800.5, llm: null },
        taxes: { value: 699.5, confidence: "medium", rules: 699.5, llm: null },
      }),
      rules,
    );
    expect(components.map((c) => c.code)).toEqual(["gross", "net", "taxes"]);
    expect(components.map((c) => c.sortOrder)).toEqual([0, 1, 2]);
  });

  it("writes money as a two-decimal string, never as a number", () => {
    const [c] = componentsFromExtraction(
      extraction({ net: { value: 1800.5, confidence: "high", rules: 1800.5, llm: null } }),
      rules,
    );
    expect(c!.amount).toBe("1800.50");
    expect(typeof c!.amount).toBe("string");
    expect(c!.unit).toBe("eur");
    expect(c!.quantity).toBeNull();
  });

  it("writes an hours field as a quantity in hours, with no amount", () => {
    const [c] = componentsFromExtraction(
      extraction({ ferieBalance: { value: 88.25, confidence: "medium", rules: 88.25, llm: null } }),
      rules,
    );
    expect(c!.amount).toBeNull();
    expect(c!.quantity).toBe("88.250000");
    expect(c!.unit).toBe("hours");
    expect(c!.kind).toBe("leave_balance");
    expect(c!.mappedTo).toEqual({ kind: "timeoff_balance", timeoffCode: "vacation" });
  });

  it("skips a field the parser could not read — a null value is never a 0.00 component", () => {
    const components = componentsFromExtraction(
      extraction({
        net: { value: 1800, confidence: "high", rules: 1800, llm: null },
        gross: { value: null, confidence: "low", rules: null, llm: null },
      }),
      rules,
    );
    expect(components.map((c) => c.code)).toEqual(["net"]);
  });

  it("carries the per-field confidence and records whether rules or the LLM produced it", () => {
    const components = componentsFromExtraction(
      extraction({
        net: { value: 1800, confidence: "high", rules: 1800, llm: null },
        taxes: { value: 700, confidence: "low", rules: null, llm: 700 },
      }),
      rules,
    );
    expect(components[0]).toMatchObject({ confidence: "high", source: "rules" });
    expect(components[1]).toMatchObject({ confidence: "low", source: "llm" });
  });

  it("keeps the Italian label as data and the kind in English (spec §2.9)", () => {
    const [c] = componentsFromExtraction(
      extraction({ net: { value: 1800, confidence: "high", rules: 1800, llm: null } }),
      rules,
    );
    expect(c!.labelRaw).toBe("Netto del mese");
    expect(c!.kind).toBe("earning");
  });

  it("returns an empty list for an extraction that read nothing at all", () => {
    expect(componentsFromExtraction(extraction({}), rules)).toEqual([]);
  });
});

describe("grossOf and netOf", () => {
  const components = componentsFromExtraction(
    extraction({
      gross: { value: 2500, confidence: "high", rules: 2500, llm: null },
      net: { value: 1800.5, confidence: "high", rules: 1800.5, llm: null },
    }),
    rules,
  );

  it("pick the two headline figures straight off the components", () => {
    expect(grossOf(components)).toBe("2500.00");
    expect(netOf(components)).toBe("1800.50");
  });

  it("answer null when the figure is absent, so the record stores null rather than zero", () => {
    expect(grossOf([])).toBeNull();
    expect(netOf([])).toBeNull();
  });
});
