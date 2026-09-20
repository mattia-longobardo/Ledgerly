import { describe, expect, it } from "vitest";
import {
  averageNet,
  averageTaxRate,
  groupByYear,
  logicalKey,
  meanCents,
  medianCents,
  parseItalianDate,
  parsePeriodLabel,
  ralEstimate,
  type RegisterPayslip,
  usagePeriodOf,
} from "./rules";

function ordinary(period: string, gross: bigint | null, net: bigint | null = 150_000n): RegisterPayslip {
  return {
    type: "ordinary",
    year: Number(period.slice(0, 4)),
    period,
    gross,
    taxesTotal: gross === null ? null : gross / 5n,
    netPay: net,
  };
}

describe("parsePeriodLabel (owner's spec L36–37)", () => {
  it("reads a month and year, and the 13th and 14th as their own types with no month", () => {
    expect(parsePeriodLabel("AGOSTO 2026")).toEqual({ type: "ordinary", year: 2026, period: "2026-08-01" });
    expect(parsePeriodLabel("dicembre  2025")).toEqual({ type: "ordinary", year: 2025, period: "2025-12-01" });
    expect(parsePeriodLabel("13a MENS. 2025")).toEqual({ type: "thirteenth", year: 2025, period: null });
    expect(parsePeriodLabel("14a MENS. 2026")).toEqual({ type: "fourteenth", year: 2026, period: null });
  });

  it("refuses anything else rather than guessing a month", () => {
    expect(parsePeriodLabel("AGOSTO")).toBeNull();
    expect(parsePeriodLabel("AUGUST 2026")).toBeNull();
    expect(parsePeriodLabel("")).toBeNull();
  });
});

describe("usagePeriodOf (owner's spec L9–20)", () => {
  it("is the month before, across the year too", () => {
    expect(usagePeriodOf("2026-08-01")).toBe("2026-07-01");
    expect(usagePeriodOf("2026-01-01")).toBe("2025-12-01");
  });
});

describe("parseItalianDate", () => {
  it("reads dd/mm/yy and dd/mm/yyyy, and refuses impossible dates", () => {
    expect(parseItalianDate("28/08/26")).toBe("2026-08-28");
    expect(parseItalianDate("01/02/2031")).toBe("2031-02-01");
    expect(parseItalianDate("31/02/26")).toBeNull();
    expect(parseItalianDate("2026-08-28")).toBeNull();
  });
});

describe("logicalKey (spec §7.8)", () => {
  it("tells December and its 13th apart, and makes a reprint the same payslip", () => {
    const base = { employerKey: "e", employeeKey: "1", year: 2025 };
    const december = logicalKey({ ...base, type: "ordinary", period: "2025-12-01" });
    expect(logicalKey({ ...base, type: "thirteenth", period: null })).not.toBe(december);
    expect(logicalKey({ ...base, type: "ordinary", period: "2025-12-01" })).toBe(december);
  });
});

describe("meanCents and medianCents", () => {
  it("ignore unknown amounts and round half away from zero", () => {
    expect(meanCents([100n, null, 101n])).toBe(101n);
    expect(meanCents([-100n, -101n])).toBe(-101n);
    expect(meanCents([null])).toBeNull();
    expect(medianCents([300n, 100n, 200n])).toBe(200n);
    expect(medianCents([100n, 200n, null])).toBe(150n);
    expect(medianCents([])).toBeNull();
  });
});

describe("the register's KPIs (spec §7.8)", () => {
  const payslips: RegisterPayslip[] = [
    ordinary("2026-01-01", 200_000n, 150_000n),
    ordinary("2026-02-01", 200_000n, 160_000n),
    ordinary("2026-03-01", 200_000n, 170_000n),
    ordinary("2026-04-01", 200_000n, 180_000n),
    { type: "thirteenth", year: 2025, period: null, gross: 90_000n, taxesTotal: 1n, netPay: 999_999n },
  ];

  it("averages the net over the latest ordinary payslips only, leaving the 13th out", () => {
    expect(averageNet(payslips, 3)).toBe(170_000n);
    expect(averageNet(payslips, 12)).toBe(165_000n);
    expect(averageNet([], 3)).toBeNull();
  });

  it("takes the tax rate as taxes over gross of the ordinary payslips", () => {
    expect(averageTaxRate(payslips)).toBeCloseTo(0.2, 6);
    expect(averageTaxRate([ordinary("2026-01-01", null)])).toBeNull();
  });

  it("estimates the yearly gross from the mean month, the 13th or a mean month in its place", () => {
    expect(ralEstimate(payslips)).toEqual({ cents: 200_000n * 13n, basis: "estimate", year: 2026 });
    const withThirteenth = [
      ...payslips,
      { type: "thirteenth" as const, year: 2026, period: null, gross: 180_000n, taxesTotal: null, netPay: null },
    ];
    expect(ralEstimate(withThirteenth)?.cents).toBe(200_000n * 12n + 180_000n);
  });

  it("sums a complete year as it is", () => {
    const year = Array.from({ length: 12 }, (_, index) =>
      ordinary(`2025-${String(index + 1).padStart(2, "0")}-01`, 100_000n + BigInt(index)),
    );
    const complete = [...year, { type: "thirteenth" as const, year: 2025, period: null, gross: 50_000n, taxesTotal: null, netPay: null }];
    expect(ralEstimate(complete)).toEqual({ cents: 1_200_066n + 50_000n, basis: "complete_year", year: 2025 });
  });

  it("groups by year, newest first, the 13th above its December", () => {
    const groups = groupByYear([
      ordinary("2025-11-01", 1n),
      ordinary("2025-12-01", 1n),
      { type: "thirteenth", year: 2025, period: null, gross: 1n, taxesTotal: null, netPay: null },
      ordinary("2026-01-01", 1n),
    ]);
    expect(groups.map((group) => [group.year, group.payslips.map((payslip) => payslip.period ?? payslip.type)])).toEqual([
      [2026, ["2026-01-01"]],
      [2025, ["thirteenth", "2025-12-01", "2025-11-01"]],
    ]);
  });
});
