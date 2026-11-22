import { describe, expect, it } from "vitest";
import type { NumberStyle } from "@ledgerly/format/format";
import { formatRate, newDraft, rateInput, readRate } from "./present";

const style = (overrides: Partial<NumberStyle>): NumberStyle => ({
  format: "it-IT",
  decimalSeparator: null,
  currencyPosition: null,
  ...overrides,
});

describe("rates in the person's own separators", () => {
  it("writes the format's own separator when none is chosen", () => {
    expect(formatRate("2.5", "it-IT")).toBe("2,5 %");
    expect(formatRate("2.5", "en-US")).toBe("2.5%");
    expect(formatRate("2.5", style({}))).toBe("2,5 %");
  });

  it("writes the decimal point chosen in Settings, on the Italian format too", () => {
    expect(formatRate("2.5", style({ decimalSeparator: "." }))).toBe("2.5 %");
    expect(rateInput("2.75", style({ decimalSeparator: "." }))).toBe("2.75");
    expect(formatRate("2.5", style({ format: "en-US", decimalSeparator: "," }))).toBe("2,5%");
  });

  it("reads back what it writes", () => {
    expect(readRate("2,75", style({}))).toBe("2.75");
    expect(readRate("2.75", style({ decimalSeparator: "." }))).toBe("2.75");
    expect(readRate("2.75", "en-US")).toBe("2.75");
    expect(readRate(" 1.002,5 %", "it-IT")).toBe("1002.5");
  });
});

describe("a new rule", () => {
  const accounts = [{ id: "a1", name: "Everyday" }];

  it("proposes the tax of the person's country pack", () => {
    expect(newDraft(accounts, "2026-11-22", "26").tax).toBe("26");
  });

  it("proposes no tax for a country without a pack (D3)", () => {
    expect(newDraft(accounts, "2026-11-22", "").tax).toBe("");
  });
});
