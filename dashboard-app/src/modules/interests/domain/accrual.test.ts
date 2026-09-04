import { describe, expect, it } from "vitest";
import { fromCents, toCents } from "@/lib/calc/money";
import { dailyInterest, projectInterest } from "./accrual";

describe("dailyInterest", () => {
  it("returns zero for a zero balance", () => {
    const r = dailyInterest({ balance: "0", annualRate: "0.0225", taxRate: "0.26", dayCount: 365, carry: "0" });
    expect(r).toEqual({ gross: "0.000000", tax: "0.000000", net: "0.00", carryAfter: "0.000000" });
  });

  it("rounds a tiny accrual to zero but keeps the remainder as carry (ported from interest.py's selftest)", () => {
    const r = dailyInterest({ balance: "1.00", annualRate: "0.0225", taxRate: "0.26", dayCount: 365, carry: "0" });
    expect(r.net).toBe("0.00");
    expect(Number(r.carryAfter)).toBeGreaterThan(0);
  });

  it("a prior carry can push a tiny accrual up to a full cent (ported from interest.py's selftest)", () => {
    const r = dailyInterest({ balance: "1.00", annualRate: "0.0225", taxRate: "0.26", dayCount: 365, carry: "0.0099" });
    expect(r.net).toBe("0.01");
  });

  it("withholds tax before rounding: net is within a cent of gross times (1 - taxRate)", () => {
    const r = dailyInterest({ balance: "10000.00", annualRate: "0.02", taxRate: "0.26", dayCount: 365, carry: "0" });
    const netBeforeRounding = Number(r.gross) * 0.74;
    expect(Math.abs(Number(r.net) - netBeforeRounding)).toBeLessThan(0.01);
  });

  it("floors a negative result at zero", () => {
    const r = dailyInterest({ balance: "-100.00", annualRate: "0.02", taxRate: "0", dayCount: 365, carry: "0" });
    expect(r.net).toBe("0.00");
  });

  // --- Boundary cases beyond the brief's happy-path set ---

  it("a zero rate accrues nothing and carries nothing forward", () => {
    const r = dailyInterest({ balance: "10000.00", annualRate: "0", taxRate: "0.26", dayCount: 365, carry: "0" });
    expect(r).toEqual({ gross: "0.000000", tax: "0.000000", net: "0.00", carryAfter: "0.000000" });
  });

  it("a zero tax rate withholds nothing: net equals gross to the cent", () => {
    // gross = 10000 * 0.02 / 365 = 0.5479452054794520... -> net rounds HALF_UP to 0.55
    const r = dailyInterest({ balance: "10000.00", annualRate: "0.02", taxRate: "0", dayCount: 365, carry: "0" });
    expect(r.tax).toBe("0.000000");
    expect(r.net).toBe("0.55");
  });

  it("a 100% tax rate withholds the entire gross: net is always zero", () => {
    const r = dailyInterest({ balance: "10000.00", annualRate: "0.02", taxRate: "1", dayCount: 365, carry: "0" });
    expect(r.net).toBe("0.00");
    expect(r.tax).toBe(r.gross);
  });

  it("uses the ACT/360 divisor exactly when dayCount is 360", () => {
    // 36000 * 0.01 / 360 = 1.00 exactly - a clean number that pins the divisor.
    const r = dailyInterest({ balance: "36000.00", annualRate: "0.01", taxRate: "0", dayCount: 360, carry: "0" });
    expect(r).toEqual({ gross: "1.000000", tax: "0.000000", net: "1.00", carryAfter: "0.000000" });
  });

  it("uses the ACT/365 divisor exactly when dayCount is 365 (same principal, different day count)", () => {
    // 36000 * 0.01 / 365 = 0.986301369863... -> rounds HALF_UP to 0.99
    const r = dailyInterest({ balance: "36000.00", annualRate: "0.01", taxRate: "0", dayCount: 365, carry: "0" });
    expect(r.net).toBe("0.99");
  });

  it("rounds an exact positive half-cent up (HALF_UP tie), leaving a negative remainder", () => {
    // Forced via carry alone: totalRaw = 0 + 0.005 exactly.
    const r = dailyInterest({ balance: "0", annualRate: "0", taxRate: "0", dayCount: 365, carry: "0.005" });
    expect(r.net).toBe("0.01");
    expect(r.carryAfter).toBe("-0.005000");
  });

  it("rounds an exact negative half-cent away from zero, then floors the posted amount at zero", () => {
    // totalRaw = -0.005 exactly: true HALF_UP would post -0.01, which floors to 0.00;
    // the carry keeps the whole -0.005 for the next day (matches interest.py: carry = raw - amount(0.00)).
    const r = dailyInterest({ balance: "0", annualRate: "0", taxRate: "0", dayCount: 365, carry: "-0.005" });
    expect(r.net).toBe("0.00");
    expect(r.carryAfter).toBe("-0.005000");
  });

  it("the first day of a rule has no prior carry and behaves the same as carry '0'", () => {
    const withZero = dailyInterest({ balance: "5000.00", annualRate: "0.015", taxRate: "0.26", dayCount: 365, carry: "0" });
    const withEmpty = dailyInterest({ balance: "5000.00", annualRate: "0.015", taxRate: "0.26", dayCount: 365, carry: "" });
    expect(withEmpty).toEqual(withZero);
  });

  // --- Strict parsing: an absent or malformed amount must throw, never silently become 0 or a truncated value ---

  it("throws rather than treating a missing balance as a zero accrual", () => {
    expect(() => dailyInterest({ balance: "", annualRate: "0.0225", taxRate: "0.26", dayCount: 365, carry: "0" })).toThrow(/balance/);
  });

  it("throws on a bare '-' balance rather than treating it as zero", () => {
    expect(() => dailyInterest({ balance: "-", annualRate: "0.0225", taxRate: "0.26", dayCount: 365, carry: "0" })).toThrow(/balance/);
  });

  it("throws on a missing annualRate or taxRate, never defaulting to zero", () => {
    expect(() => dailyInterest({ balance: "100.00", annualRate: "", taxRate: "0.26", dayCount: 365, carry: "0" })).toThrow(/annualRate/);
    expect(() => dailyInterest({ balance: "100.00", annualRate: "0.0225", taxRate: "", dayCount: 365, carry: "0" })).toThrow(/taxRate/);
  });

  it("throws on a two-dot balance instead of silently dropping the trailing segment (1.2.3 must not become 1.2)", () => {
    expect(() => dailyInterest({ balance: "1.2.3", annualRate: "0.0225", taxRate: "0.26", dayCount: 365, carry: "0" })).toThrow(/balance/);
  });

  it("throws on a two-dot carry too, even though an empty carry is allowed", () => {
    expect(() => dailyInterest({ balance: "100.00", annualRate: "0.0225", taxRate: "0.26", dayCount: 365, carry: "0.1.2" })).toThrow(/carry/);
  });

  // --- Rate validation: rejected, not silently run (Important 4 — chosen resolution) ---

  it("rejects a negative annualRate rather than accruing negative interest forever", () => {
    expect(() => dailyInterest({ balance: "1000.00", annualRate: "-0.01", taxRate: "0.26", dayCount: 365, carry: "0" })).toThrow(/annualRate/);
  });

  it("rejects a taxRate above 1 (a likely percentage-vs-fraction typo, e.g. '1.26' meaning 26%)", () => {
    expect(() => dailyInterest({ balance: "1000.00", annualRate: "0.02", taxRate: "1.26", dayCount: 365, carry: "0" })).toThrow(/taxRate/);
  });

  it("rejects a negative taxRate", () => {
    expect(() => dailyInterest({ balance: "1000.00", annualRate: "0.02", taxRate: "-0.01", dayCount: 365, carry: "0" })).toThrow(/taxRate/);
  });

  it("accepts taxRate at both closed-interval endpoints, 0 and 1", () => {
    expect(() => dailyInterest({ balance: "1000.00", annualRate: "0.02", taxRate: "0", dayCount: 365, carry: "0" })).not.toThrow();
    expect(() => dailyInterest({ balance: "1000.00", annualRate: "0.02", taxRate: "1", dayCount: 365, carry: "0" })).not.toThrow();
  });
});

describe("dailyInterest conservation invariant", () => {
  it("for a single day, net + carryAfter equals (gross - tax) + priorCarry, within the documented per-call truncation", () => {
    const priorCarry = "0.123456";
    const r = dailyInterest({ balance: "13729.65", annualRate: "0.0225", taxRate: "0.26", dayCount: 365, carry: priorCarry });
    const netRawApprox = Number(r.gross) - Number(r.tax);
    const lhs = Number(r.net) + Number(r.carryAfter);
    const rhs = netRawApprox + Number(priorCarry);
    // Three independent 6-decimal-place truncations (gross, tax, carryAfter)
    // each bound the error at < 1e-6 (measured: 0 for this input, since the
    // truncations happen to cancel); 1e-5 leaves headroom for inputs where
    // they don't, while still catching a real regression (a dropped carry,
    // a sign flip, a wrong clamp order) by three orders of magnitude.
    expect(Math.abs(lhs - rhs)).toBeLessThan(1e-5);
  });

  it("over many days, the sum of posted net amounts plus the final carry equals the sum of net-of-tax raw accrual, to within the documented per-day truncation", () => {
    const input = { balance: "1234.56", annualRate: "0.0225", taxRate: "0.26", dayCount: 365 as const };
    const days = 365;
    let carry = "0";
    let sumNetCents = 0;
    let sumNetRawApprox = 0;
    for (let i = 0; i < days; i += 1) {
      const r = dailyInterest({ ...input, carry });
      sumNetCents += toCents(r.net)!;
      sumNetRawApprox += Number(r.gross) - Number(r.tax);
      carry = r.carryAfter;
    }
    const lhs = fromCents(sumNetCents) + Number(carry);
    // Measured for this input: ~5.2e-7/day (~1.9e-4 over the full year).
    // The bound is linear in days, not geometric — the carry is only ever
    // added, never multiplied by the rate, so there is no feedback path for
    // one day's truncation to compound into the next. 5e-6/day leaves ~10x
    // headroom over the measured value while staying five orders of
    // magnitude tighter than a cent for a full year.
    expect(Math.abs(lhs - sumNetRawApprox)).toBeLessThan(days * 5e-6);
  });
});

describe("projectInterest", () => {
  it("produces one point per day with a non-decreasing cumulative total", () => {
    const points = projectInterest({ balance: "10000.00", annualRate: "0.0225", taxRate: "0.26", dayCount: 365 }, new Date("2026-09-01"), 5);
    expect(points).toHaveLength(5);
    for (let i = 1; i < points.length; i += 1) {
      expect(Number(points[i]!.cumulativeNet)).toBeGreaterThanOrEqual(Number(points[i - 1]!.cumulativeNet));
    }
  });

  it("returns no points for a zero-day projection", () => {
    expect(projectInterest({ balance: "10000.00", annualRate: "0.0225", taxRate: "0.26", dayCount: 365 }, new Date("2026-09-01"), 0)).toEqual([]);
  });

  it("carries the sub-cent remainder across a day so the cumulative total is not just net * days", () => {
    // Each day's net alone rounds to 0.00 (tiny balance), but the carry accumulates
    // and eventually posts a cent - the cumulative total must reflect that, not stay at 0.
    const points = projectInterest({ balance: "1.00", annualRate: "0.0225", taxRate: "0.26", dayCount: 365 }, new Date("2026-01-01"), 200);
    const last = points[points.length - 1]!;
    expect(Number(last.cumulativeNet)).toBeGreaterThan(0);
  });

  it("steps calendar dates correctly across a leap day (2028 is a leap year)", () => {
    const points = projectInterest({ balance: "10000.00", annualRate: "0.0225", taxRate: "0.26", dayCount: 365 }, new Date("2028-02-27"), 5);
    expect(points.map((p) => p.date)).toEqual(["2028-02-27", "2028-02-28", "2028-02-29", "2028-03-01", "2028-03-02"]);
  });
});
