import { describe, expect, it } from "vitest";
import type { NumberStyle } from "@/platform/format";
import { formatRate, rateInput, readRate } from "./present";

const style = (overrides: Partial<NumberStyle>): NumberStyle => ({
  format: "it-IT",
  decimalSeparator: null,
  currencyPosition: null,
  ...overrides,
});

describe("rates in the person's own separators", () => {
  it("writes the format's own separator when none is chosen", () => {
    expect(formatRate("0.025000", "it-IT")).toBe("2,5 %");
    expect(formatRate("0.025000", "en-US")).toBe("2.5%");
    expect(formatRate("0.025000", style({}))).toBe("2,5 %");
  });

  it("writes the decimal point chosen in Settings, on the Italian format too", () => {
    expect(formatRate("0.025000", style({ decimalSeparator: "." }))).toBe("2.5 %");
    expect(rateInput("0.027500", style({ decimalSeparator: "." }))).toBe("2.75");
    expect(formatRate("0.025000", style({ format: "en-US", decimalSeparator: "," }))).toBe("2,5%");
  });

  it("reads back what it writes", () => {
    expect(readRate("2,75", style({}))).toBe("2.75");
    expect(readRate("2.75", style({ decimalSeparator: "." }))).toBe("2.75");
    expect(readRate("2.75", "en-US")).toBe("2.75");
    expect(readRate(" 1.002,5 %", "it-IT")).toBe("1002.5");
  });
});
