import { describe, expect, it } from "vitest";
import { centsFromNumber, centsToDecimal, parseCents, sumCents } from "./money";

describe("parseCents", () => {
  it.each([
    ["1234.56", 123456n],
    ["12", 1200n],
    ["1.2", 120n],
    ["0.005", 1n],
    ["0.0049", 0n],
    ["-0.005", -1n],
    ["-1.235", -124n],
    [" 7.10 ", 710n],
    ["-0", 0n],
  ])("parses %s", (input, expected) => {
    expect(parseCents(input)).toBe(expected);
  });

  it.each(["1.234,56", "1,5", "1e3", "€1", "", "abc", "1.2.3"])("rejects %s", (input) => {
    expect(() => parseCents(input)).toThrow(RangeError);
  });
});

describe("centsFromNumber", () => {
  it("goes through the decimal representation, never float arithmetic", () => {
    expect(centsFromNumber(0.1 + 0.2)).toBe(30n);
    expect(centsFromNumber(-12.345)).toBe(-1235n);
    expect(centsFromNumber(2615.39)).toBe(261539n);
  });

  it("rejects non-finite and out-of-range values", () => {
    expect(() => centsFromNumber(Number.NaN)).toThrow(RangeError);
    expect(() => centsFromNumber(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => centsFromNumber(1e16)).toThrow(RangeError);
  });
});

describe("centsToDecimal", () => {
  it.each([
    [123456n, "1234.56"],
    [-5n, "-0.05"],
    [0n, "0.00"],
    [100n, "1.00"],
  ])("formats %s", (cents, expected) => {
    expect(centsToDecimal(cents)).toBe(expected);
  });
});

describe("sumCents", () => {
  it("keeps unknown distinct from zero", () => {
    expect(sumCents([100n, null, 50n])).toEqual({ total: 150n, partial: true });
    expect(sumCents([null, null])).toEqual({ total: null, partial: true });
    expect(sumCents([])).toEqual({ total: null, partial: false });
    expect(sumCents([0n])).toEqual({ total: 0n, partial: false });
  });
});
