import { describe, expect, it } from "vitest";
import { fromCents, roundEur, sumCents, toCents } from "./money";

describe("toCents", () => {
  it("normalises pg numeric strings", () => {
    expect(toCents("1234.56")).toBe(123456);
    expect(toCents("0.00")).toBe(0);
    expect(toCents("-42.10")).toBe(-4210);
    expect(toCents("7")).toBe(700);
    expect(toCents(".5")).toBe(50);
  });

  it("normalises numbers without float drift", () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(1234.56)).toBe(123456);
    expect(toCents(-0.07)).toBe(-7);
  });

  it("rounds half up at the third decimal", () => {
    expect(toCents("1.005")).toBe(101);
    expect(toCents("1.004")).toBe(100);
    expect(toCents("-1.005")).toBe(-101);
  });

  it("returns null for nullish and unparseable input", () => {
    expect(toCents(null)).toBeNull();
    expect(toCents(undefined)).toBeNull();
    expect(toCents("")).toBeNull();
    expect(toCents("   ")).toBeNull();
    expect(toCents("abc")).toBeNull();
    expect(toCents("1.234,56")).toBeNull();
    expect(toCents(Number.NaN)).toBeNull();
    expect(toCents(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("sumCents / fromCents", () => {
  it("adds 0.1 + 0.2 exactly", () => {
    expect(fromCents(sumCents([0.1, 0.2]))).toBe(0.3);
    expect(fromCents(sumCents(["0.10", "0.20"]))).toBe(0.3);
  });

  it("keeps a long series of numeric strings exact", () => {
    const values = Array.from({ length: 1000 }, () => "0.07");
    expect(sumCents(values)).toBe(7000);
    expect(fromCents(sumCents(values))).toBe(70);
  });

  it("stays exact where naive float addition drifts", () => {
    const values = ["1234.56", "78.90", "-0.07", "0.01", "999.99"];
    const naive = values.reduce((a, v) => a + Number(v), 0);
    expect(naive).not.toBe(2313.39);
    expect(fromCents(sumCents(values))).toBe(2313.39);
  });

  it("skips nullish members", () => {
    expect(sumCents(["10.00", null, undefined, "5.50"])).toBe(1550);
    expect(sumCents([])).toBe(0);
  });

  it("maps nullish cents back to null", () => {
    expect(fromCents(null)).toBeNull();
    expect(fromCents(undefined)).toBeNull();
    expect(fromCents(-1)).toBe(-0.01);
  });
});

describe("roundEur", () => {
  it("rounds to cents by default", () => {
    expect(roundEur(0.1 + 0.2)).toBe(0.3);
    expect(roundEur(2.345)).toBe(2.35);
    expect(roundEur(1 / 3, 4)).toBe(0.3333);
  });

  it("passes non-finite values through untouched", () => {
    expect(Number.isNaN(roundEur(Number.NaN))).toBe(true);
  });
});
