import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { PayslipField } from "@/lib/contracts";
import { PAYSLIP_FIELDS } from "@/lib/contracts";
import type { PayslipHistoryEntry } from "@/lib/payroll/confidence";
import type { LlmPassResult } from "@/lib/payroll/llm";
import { detectThirteenth, parsePayslip, PARSER_VERSION } from "@/lib/payroll/parse";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), "utf8");
}

const PDF = fixture("august-2026.pdf.txt");
const OCR = fixture("august-2026.ocr.txt");
const TREDICESIMA = fixture("december-2026-tredicesima.txt");
const GARBAGE = fixture("garbage.ocr.txt");

/** Every test stubs the LLM: the suite must never touch the network. */
function stubLlm(
  fields: Partial<Record<PayslipField, number | null>>,
  extra: Partial<LlmPassResult> = {},
) {
  return vi.fn(
    async (): Promise<LlmPassResult> => ({ fields, isThirteenth: null, month: null, ...extra }),
  );
}

const AUGUST_LLM: Partial<Record<PayslipField, number | null>> = {
  gross: 3000,
  net: 2035.8,
  taxes: 643.5,
  fundContribEmployee: 37.2,
  fundContribEmployer: 46.5,
  ferieBalance: 45.33,
  rolBalance: 12,
  permessiBalance: 12,
  ferieTakenHours: 16,
};

const HISTORY: readonly PayslipHistoryEntry[] = [
  { month: "2026-05-01", net: 2000, gross: 3000, ferieBalance: 30, rolBalance: 10 },
  { month: "2026-06-01", net: 2010, gross: 3000, ferieBalance: 40, rolBalance: 11 },
  { month: "2026-07-01", net: 2020, gross: 3000, ferieBalance: 45.33, rolBalance: 12 },
];

describe("parsePayslip on a normal month (clean PDF text)", () => {
  it("returns high confidence when both passes agree", async () => {
    const llm = stubLlm(AUGUST_LLM);
    const result = await parsePayslip({
      text: PDF,
      textSource: "pdf",
      history: HISTORY,
      llm,
    });

    expect(llm).toHaveBeenCalledTimes(1);
    expect(result.parserVersion).toBe(PARSER_VERSION);
    expect(result.month).toBe("2026-08-01");
    expect(result.isThirteenth).toBe(false);
    expect(result.textSource).toBe("pdf");
    expect(result.llmError).toBeUndefined();

    // `rolTakenHours` has no label to anchor on — it is read from the leave
    // grid by `teamsystem.ts`, which this synthetic fixture does not reproduce,
    // so it legitimately stays low here.
    for (const field of PAYSLIP_FIELDS.filter((f) => f !== "rolTakenHours")) {
      expect(result.fields[field]?.confidence, field).toBe("high");
    }
    expect(result.fields.rolTakenHours?.confidence).toBe("low");
    expect(result.fields.net?.value).toBe(2035.8);
    expect(result.fields.ferieBalance?.value).toBe(45.33);
    expect(result.checks.every((c) => c.passed)).toBe(true);
  });

  it("drops a field to low when the two passes disagree", async () => {
    const result = await parsePayslip({
      text: PDF,
      textSource: "pdf",
      llm: stubLlm({ ...AUGUST_LLM, net: 2000 }),
    });
    expect(result.fields.net?.confidence).toBe("low");
    expect(result.fields.net?.rules).toBe(2035.8);
    expect(result.fields.net?.llm).toBe(2000);
    expect(result.fields.gross?.confidence).toBe("high");
  });
});

describe("parsePayslip on degraded OCR text", () => {
  it("returns the flattened-grid fields as low confidence rather than wrong", async () => {
    const result = await parsePayslip({
      text: OCR,
      textSource: "ocr",
      history: HISTORY,
      llm: stubLlm({ ...AUGUST_LLM, ferieBalance: null, rolBalance: null, permessiBalance: null }),
    });

    for (const field of ["ferieBalance", "rolBalance", "permessiBalance"] as const) {
      expect(result.fields[field]?.confidence, field).toBe("low");
      expect(result.fields[field]?.value, field).toBeNull();
    }
    // The label-anchored figures survive the OCR damage.
    expect(result.fields.net?.value).toBe(2035.8);
    expect(result.fields.net?.confidence).toBe("high");
    expect(result.fields.gross?.value).toBe(3000);
  });

  it("still refuses the column when only the LLM guessed one", async () => {
    const result = await parsePayslip({
      text: OCR,
      textSource: "ocr",
      llm: stubLlm(AUGUST_LLM),
    });
    expect(result.fields.ferieBalance?.confidence).toBe("low");
    expect(result.fields.ferieBalance?.note).toContain("grid flattened");
  });
});

describe("tredicesima detection", () => {
  it("signal 1: an explicit keyword", async () => {
    const result = await parsePayslip({
      text: TREDICESIMA,
      textSource: "pdf",
      history: HISTORY,
      llm: stubLlm({ net: 1994.6 }),
    });
    expect(result.month).toBe("2026-12-01");
    expect(result.isThirteenth).toBe(true);
    expect(result.checks.find((c) => c.id === "tredicesima")?.detail).toContain("TREDICESIMA");
  });

  it("signal 2: a December document with no ordinary-month rows", async () => {
    // Case-insensitive: the fixture's own header comment names the keyword too.
    const withoutKeyword = TREDICESIMA.replace(/tredicesima/gi, "COMPENSO");
    const detection = detectThirteenth({
      text: withoutKeyword,
      month: "2026-12-01",
      net: 1994.6,
      history: HISTORY,
    });
    expect(detection.signals.keyword).toBeNull();
    expect(detection.signals.december).toBe(true);
    expect(detection.signals.ordinaryMarkers).toBe(false);
    expect(detection.isThirteenth).toBe(true);

    // An ordinary December payslip is not mislabelled.
    const ordinaryDecember = detectThirteenth({
      text: PDF.replace(/AGOSTO/g, "DICEMBRE"),
      month: "2026-12-01",
      net: 2035.8,
      history: HISTORY,
    });
    expect(ordinaryDecember.isThirteenth).toBe(false);
  });

  it("signal 3: net at roughly twice the trailing median", async () => {
    const halfHistory: readonly PayslipHistoryEntry[] = HISTORY.map((h) => ({
      ...h,
      net: (h.net ?? 0) / 2,
    }));
    const result = await parsePayslip({
      text: PDF,
      textSource: "pdf",
      history: halfHistory,
      llm: stubLlm(AUGUST_LLM),
    });
    expect(result.isThirteenth).toBe(true);
    expect(result.checks.find((c) => c.id === "tredicesima")?.detail).toContain("ordinary median");
    // The ±40 % band would always fail on a tredicesima, so it is not run.
    expect(result.checks.find((c) => c.id === "net_vs_median")).toBeUndefined();
  });
});

describe("failure handling", () => {
  it("degrades garbage text to an all-low row without throwing", async () => {
    const result = await parsePayslip({
      text: GARBAGE,
      textSource: "ocr",
      month: "2026-08-01",
      history: HISTORY,
      llm: stubLlm({}),
    });
    for (const field of PAYSLIP_FIELDS) {
      expect(result.fields[field]?.confidence, field).toBe("low");
      expect(result.fields[field]?.value, field).toBeNull();
    }
    expect(result.isThirteenth).toBe(false);
    expect(result.month).toBe("2026-08-01");
  });

  it("keeps the rules result when the LLM pass fails", async () => {
    const result = await parsePayslip({
      text: PDF,
      textSource: "pdf",
      llm: async () => ({ fields: {}, isThirteenth: null, month: null, error: "llm timed out" }),
    });
    expect(result.llmError).toBe("llm timed out");
    expect(result.fields.net?.value).toBe(2035.8);
    expect(result.fields.net?.confidence).toBe("medium");
  });

  it("survives an LLM pass that throws", async () => {
    const result = await parsePayslip({
      text: PDF,
      textSource: "pdf",
      llm: async () => {
        throw new Error("boom");
      },
    });
    expect(result.llmError).toContain("llm pass failed");
    expect(result.fields.gross?.value).toBe(3000);
  });

  it("never throws on empty input", async () => {
    const result = await parsePayslip({ text: "", textSource: "ocr", llm: stubLlm({}) });
    expect(result.month).toBeNull();
    expect(result.fields.net?.confidence).toBe("low");
  });
});
