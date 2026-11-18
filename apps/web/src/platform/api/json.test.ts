import { describe, expect, it } from "vitest";
import { centsFrom, instant, money } from "./json";

describe("money", () => {
  it("writes cents as a decimal string, and the unknown as null", () => {
    expect(money(123_456n)).toBe("1234.56");
    expect(money(-5n)).toBe("-0.05");
    expect(money(0n)).toBe("0.00");
    expect(money(null)).toBeNull();
  });

  it("keeps an amount no JSON number could carry", () => {
    expect(money(9_007_199_254_740_993n)).toBe("90071992547409.93");
  });
});

describe("centsFrom", () => {
  it("reads back what money wrote", () => {
    for (const cents of [0n, 1n, -1n, 123_456n, 9_007_199_254_740_993n]) {
      expect(centsFrom(money(cents) as string)).toBe(cents);
    }
  });

  it("refuses a number, so no rounding is invented on the way in", () => {
    expect(centsFrom(12.34)).toBeNull();
    expect(centsFrom(null)).toBeNull();
    expect(centsFrom("twelve")).toBeNull();
    expect(centsFrom("")).toBeNull();
  });
});

describe("instant", () => {
  it("writes UTC ISO 8601, and nothing as null", () => {
    expect(instant(new Date("2026-09-21T08:15:00Z"))).toBe("2026-09-21T08:15:00.000Z");
    expect(instant(null)).toBeNull();
    expect(instant(undefined)).toBeNull();
  });
});
