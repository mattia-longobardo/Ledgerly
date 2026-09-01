import { describe, expect, it } from "vitest";
import { parseItalianNumber } from "@/lib/format";
import { extractPdfText, fixNumericOcr, normalizeText, splitLines } from "@/lib/payroll/text";

describe("parseItalianNumber", () => {
  it("parses the payslip's thousands/decimal convention", () => {
    expect(parseItalianNumber("1.234,56")).toBe(1234.56);
    expect(parseItalianNumber("3.000,00")).toBe(3000);
    expect(parseItalianNumber("45,33")).toBe(45.33);
    expect(parseItalianNumber("0,10")).toBe(0.1);
    expect(parseItalianNumber("1.234.567,89")).toBe(1234567.89);
  });

  it("returns null on junk instead of NaN", () => {
    expect(parseItalianNumber("~~~")).toBeNull();
    expect(parseItalianNumber("")).toBeNull();
    expect(parseItalianNumber(null)).toBeNull();
  });
});

describe("normalizeText", () => {
  it("collapses whitespace and drops empty lines", () => {
    expect(normalizeText("  NETTO   BUSTA    2.035,80  \n\n\n  TOTALE LORDO 3.000,00 ")).toBe(
      "NETTO BUSTA 2.035,80\nTOTALE LORDO 3.000,00",
    );
  });

  it("normalizes CRLF and non-breaking spaces", () => {
    expect(normalizeText("A 1,00\r\nB\t2,00")).toBe("A 1,00\nB 2,00");
  });

  it("repairs OCR digit confusions inside numbers only", () => {
    expect(normalizeText("NETTO BUSTA 2.O35,8O")).toBe("NETTO BUSTA 2.035,80");
    // Labels keep their letters even though they contain O/I/S/B.
    expect(normalizeText("IMPON. CONTR. SOC. 3.000,00")).toBe("IMPON. CONTR. SOC. 3.000,00");
    expect(fixNumericOcr("FONDO")).toBe("FONDO");
    expect(fixNumericOcr("A.C.(hh)")).toBe("A.C.(hh)");
    // Ambiguous leftovers are left alone rather than guessed at.
    expect(fixNumericOcr("1O,OOx")).toBe("1O,OOx");
  });

  it("is null-safe", () => {
    expect(normalizeText(null)).toBe("");
    expect(splitLines("")).toEqual([]);
  });
});

describe("extractPdfText", () => {
  it("is a documented stub that falls back to OCR instead of throwing", async () => {
    await expect(extractPdfText(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).resolves.toBeNull();
  });
});
