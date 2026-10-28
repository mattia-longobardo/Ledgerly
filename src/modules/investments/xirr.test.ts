import { describe, expect, it } from "vitest";
import { xirr } from "./xirr";

const eur = (value: number) => BigInt(Math.round(value * 100));

describe("XIRR (§2.4, D8)", () => {
  it("finds the one rate: 1000 in, 1100 out a year later is 10 %", () => {
    const result = xirr([
      { on: "2025-01-01", cents: -eur(1000) },
      { on: "2026-01-01", cents: eur(1100) },
    ]);
    expect(result.status).toBe("ok");
    expect(result.status === "ok" && result.rate).toBeCloseTo(0.1, 8);
  });

  it("weighs money by the time it stayed in", () => {
    // 1000 for the whole year, 1000 more for half of it, 2150 at the end: about 9.9 %.
    const result = xirr([
      { on: "2025-01-01", cents: -eur(1000) },
      { on: "2025-07-02", cents: -eur(1000) },
      { on: "2026-01-01", cents: eur(2150) },
    ]);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    const npv =
      -1000 + -1000 / Math.pow(1 + result.rate, 182 / 365) + 2150 / Math.pow(1 + result.rate, 365 / 365);
    expect(Math.abs(npv)).toBeLessThan(1e-4);
  });

  it("finds a loss as well: 1000 in, 500 out a year later is −50 %", () => {
    const result = xirr([
      { on: "2025-01-01", cents: -eur(1000) },
      { on: "2026-01-01", cents: eur(500) },
    ]);
    expect(result.status === "ok" && result.rate).toBeCloseTo(-0.5, 8);
  });

  it("has no solution when money only went in, or only came out", () => {
    expect(xirr([{ on: "2025-01-01", cents: -eur(1000) }])).toEqual({ status: "none" });
    expect(
      xirr([
        { on: "2025-01-01", cents: -eur(1000) },
        { on: "2026-01-01", cents: 0n },
      ]),
    ).toEqual({ status: "none" });
    expect(xirr([])).toEqual({ status: "none" });
  });

  it("has no solution inside [−99 %, +1000 %]", () => {
    // −99.5 % in a year: below the interval.
    expect(
      xirr([
        { on: "2025-01-01", cents: -eur(1000) },
        { on: "2026-01-01", cents: eur(5) },
      ]),
    ).toEqual({ status: "none" });
    // ×20 in a year, +1900 %: above it.
    expect(
      xirr([
        { on: "2025-01-01", cents: -eur(1000) },
        { on: "2026-01-01", cents: eur(20000) },
      ]),
    ).toEqual({ status: "none" });
  });

  it("is not computable with more than one solution", () => {
    // −1000, +2300, −1320 a year apart: both 10 % and 20 % are solutions.
    expect(
      xirr([
        { on: "2025-01-01", cents: -eur(1000) },
        { on: "2026-01-01", cents: eur(2300) },
        { on: "2027-01-01", cents: -eur(1320) },
      ]),
    ).toEqual({ status: "multiple" });
  });
});
