import { describe, expect, it } from "vitest";
import {
  annualTotals,
  averageNet,
  averageTaxes,
  ferieRemaining,
  isThirteenthCandidate,
  netPerMonthSeries,
  ral,
  leaveTakenByMonth,
  leaveTakenYtd,
  type PayslipLike,
} from "./payroll";

const NOW = new Date("2026-07-15T12:00:00Z");

function ordinary(month: string, over: Partial<PayslipLike> = {}): PayslipLike {
  return {
    month,
    isThirteenth: false,
    status: "verified",
    supersededBy: null,
    gross: "3000.00",
    net: "2000.00",
    taxes: "700.00",
    fundContribEmployee: "50.00",
    fundContribEmployer: "100.00",
    ...over,
  };
}

const year2025: PayslipLike[] = [
  ...Array.from({ length: 12 }, (_, i) =>
    ordinary(`2025-${String(i + 1).padStart(2, "0")}-01`),
  ),
  ordinary("2025-12-01", {
    isThirteenth: true,
    gross: "3000.00",
    net: "2400.00",
    taxes: "600.00",
    fundContribEmployee: "50.00",
    fundContribEmployer: "100.00",
  }),
];

describe("averages exclude the tredicesima", () => {
  it("ignores the 13th row in averageNet", () => {
    const withThirteenth = averageNet(year2025, 3, { asOf: "2025-12-01" });
    const without = averageNet(
      year2025.filter((p) => !p.isThirteenth),
      3,
      { asOf: "2025-12-01" },
    );
    expect(withThirteenth).toBe(2000);
    expect(withThirteenth).toBe(without);
  });

  it("ignores the 13th row in averageTaxes", () => {
    expect(averageTaxes(year2025, 3, { asOf: "2025-12-01" })).toBe(700);
  });

  it("divides by the months with data, not by the requested window", () => {
    const sparse = [ordinary("2025-11-01", { net: "2000.00" }), ordinary("2025-12-01", { net: "2400.00" })];
    expect(averageNet(sparse, 6, { asOf: "2025-12-01" })).toBe(2200);
  });

  it("returns null when the window holds no data", () => {
    expect(averageNet(year2025, 3, { asOf: "2024-06-01" })).toBeNull();
    expect(averageNet([], 12, { now: NOW })).toBeNull();
    expect(averageNet(year2025, 0, { asOf: "2025-12-01" })).toBeNull();
  });

  it("skips unverified and superseded rows", () => {
    const rows = [
      ordinary("2025-11-01", { net: "9999.00", status: "parsed" }),
      ordinary("2025-12-01", { net: "2000.00", supersededBy: 7 }),
      ordinary("2025-10-01", { net: "2000.00" }),
    ];
    expect(averageNet(rows, 3, { asOf: "2025-12-01" })).toBe(2000);
  });

  it("defaults the window to the current month via injected now", () => {
    const rows = [ordinary("2026-06-01", { net: "2100.00" }), ordinary("2026-07-01", { net: "2300.00" })];
    expect(averageNet(rows, 3, { now: NOW })).toBe(2200);
  });
});

describe("annualTotals includes the tredicesima", () => {
  it("sums gross, net, taxes and Cometa deposits over the whole year", () => {
    expect(annualTotals(year2025, 2025)).toEqual({
      gross: 39000,
      net: 26400,
      taxes: 9000,
      cometaDeposits: 1950,
    });
  });

  it("counts only the requested year", () => {
    expect(annualTotals(year2025, 2024)).toEqual({
      gross: 0,
      net: 0,
      taxes: 0,
      cometaDeposits: 0,
    });
  });
});

describe("ral", () => {
  it("sums TOTALE LORDO with the tredicesima included for a complete year", () => {
    expect(ral(year2025, 2025, { now: NOW })).toEqual({
      ytdGross: 39000,
      projected: null,
      isProjected: false,
    });
  });

  it("flags the projection for an incomplete year", () => {
    const ytd = Array.from({ length: 6 }, (_, i) =>
      ordinary(`2026-${String(i + 1).padStart(2, "0")}-01`),
    );
    const r = ral(ytd, 2026, { now: NOW });
    expect(r.ytdGross).toBe(18000);
    expect(r.isProjected).toBe(true);
    expect(r.projected).toBe(39000);
  });

  it("uses the filed tredicesima instead of an estimated one when present", () => {
    const ytd = [
      ...Array.from({ length: 6 }, (_, i) => ordinary(`2026-${String(i + 1).padStart(2, "0")}-01`)),
      ordinary("2026-06-01", { isThirteenth: true, gross: "3500.00" }),
    ];
    expect(ral(ytd, 2026, { now: NOW }).projected).toBe(39500);
  });

  it("has no projection without ordinary months", () => {
    expect(ral([], 2026, { now: NOW })).toEqual({
      ytdGross: 0,
      projected: null,
      isProjected: true,
    });
  });
});

describe("ferieRemaining", () => {
  const latest = ordinary("2026-07-01", {
    ferieBalance: "62.50",
    ferieUnit: "hours",
    rolBalance: "17.50",
    rolUnit: "hours",
    permessiBalance: "8.00",
    permessiUnit: "hours",
  });

  it("combines ferie + ROL and converts hours to days", () => {
    const r = ferieRemaining(latest);
    expect(r.ferieHours).toBe(62.5);
    expect(r.rolHours).toBe(17.5);
    expect(r.combinedHours).toBe(80);
    expect(r.combinedDays).toBe(10);
  });

  it("honours a non-default hours-per-day setting", () => {
    expect(ferieRemaining(latest, 7.5).combinedDays).toBeCloseTo(80 / 7.5, 12);
  });

  it("keeps permessi out of the headline", () => {
    const r = ferieRemaining(latest);
    expect(r.permessiHours).toBe(8);
    expect(r.combinedHours).toBe(80);
    expect(r.combinedDays).toBe(10);
  });

  it("converts a payslip that states balances in days", () => {
    const inDays = ordinary("2026-07-01", {
      ferieBalance: "5.00",
      ferieUnit: "days",
      rolBalance: "1.00",
      rolUnit: "days",
    });
    expect(ferieRemaining(inDays).combinedHours).toBe(48);
    expect(ferieRemaining(inDays).combinedDays).toBe(6);
  });

  it("returns nulls with no payslip and tolerates partial balances", () => {
    expect(ferieRemaining(null)).toEqual({
      ferieHours: null,
      rolHours: null,
      combinedHours: null,
      combinedDays: null,
      permessiHours: null,
    });
    const partial = ferieRemaining(ordinary("2026-07-01", { ferieBalance: "8.00" }));
    expect(partial.rolHours).toBeNull();
    expect(partial.combinedHours).toBe(8);
    expect(partial.combinedDays).toBe(1);
  });
});

describe("netPerMonthSeries", () => {
  const rows = [
    ordinary("2026-05-01", { net: "2000.00" }),
    ordinary("2026-07-01", { net: "2100.00" }),
    ordinary("2026-07-01", { isThirteenth: true, net: "2400.00" }),
  ];

  it("emits one point per month with nulls for missing months", () => {
    expect(netPerMonthSeries(rows, "3M", { now: NOW })).toEqual([
      { month: "2026-05-01", value: 2000 },
      { month: "2026-06-01", value: null },
      { month: "2026-07-01", value: 2100 },
    ]);
  });

  it("can fold the tredicesima in on request", () => {
    const series = netPerMonthSeries(rows, "3M", { now: NOW, includeThirteenth: true });
    expect(series[2]).toEqual({ month: "2026-07-01", value: 4500 });
  });
});

describe("isThirteenthCandidate", () => {
  it("fires on the keywords", () => {
    expect(isThirteenthCandidate({ text: "Competenze TREDICESIMA mensilità" })).toBe(true);
    expect(isThirteenthCandidate({ text: "erogazione 13ma" })).toBe(true);
    expect(isThirteenthCandidate({ text: "GRATIFICA  NATALIZIA 2025" })).toBe(true);
  });

  it("fires on a net around twice the median", () => {
    expect(isThirteenthCandidate({ month: "2025-07-01", net: "4000.00", medianNet: "2000.00" })).toBe(
      true,
    );
  });

  it("does not flag an ordinary December payslip", () => {
    expect(
      isThirteenthCandidate({ month: "2025-12-01", net: "2050.00", medianNet: "2000.00" }),
    ).toBe(false);
  });

  it("treats December plus an elevated net as a candidate", () => {
    expect(
      isThirteenthCandidate({ month: "2025-12-01", net: "2900.00", medianNet: "2000.00" }),
    ).toBe(true);
  });

  it("is false with nothing to go on", () => {
    expect(isThirteenthCandidate({})).toBe(false);
    expect(isThirteenthCandidate({ month: "2025-12-01", net: "2000.00", medianNet: null })).toBe(
      false,
    );
  });
});

describe("leave actually used, per month", () => {
  const v = (month: string, ferieTaken: number, rolTaken: number) => ({
    month, isThirteenth: false, status: "verified", supersededBy: null,
    ferieTaken, rolTaken,
  });

  it("attributes usage to the month BEFORE the payslip", () => {
    // Owner's rule: "agosto ha luglio". The August payslip's FERIE GOD. of
    // 12,01 h is July's usage.
    const rows = leaveTakenByMonth([v("2026-08-01", 12.01, 0)]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.month).toBe("2026-07-01");
    expect(rows[0]!.ferieHours).toBe(12.01);
  });

  it("converts to days at the configured ratio", () => {
    const rows = leaveTakenByMonth([v("2026-08-01", 16, 8)], 8);
    expect(rows[0]!.ferieDays).toBe(2);
    expect(rows[0]!.rolDays).toBe(1);
    expect(rows[0]!.totalDays).toBe(3);
  });

  it("ignores a tredicesima, which repeats December's grid", () => {
    const thirteenth = { ...v("2025-12-01", 26.66, 17.34), isThirteenth: true };
    expect(leaveTakenByMonth([thirteenth])).toEqual([]);
  });

  it("ignores rows that are not verified", () => {
    const pending = { ...v("2026-08-01", 12.01, 0), status: "parsed" };
    expect(leaveTakenByMonth([pending])).toEqual([]);
  });

  it("sums a year to date, in days", () => {
    const ytd = leaveTakenYtd(
      [v("2026-03-01", 8, 0), v("2026-04-01", 16, 8), v("2027-01-01", 80, 0)],
      2026,
      8,
    );
    // March payslip -> February 2026 (1 d); April -> March 2026 (2 d); and the
    // January 2027 payslip reports December 2026 (10 d), so it counts for 2026.
    expect(ytd.ferieDays).toBe(13);
    expect(ytd.rolDays).toBe(1);
    expect(ytd.totalDays).toBe(14);
  });

  it("returns nothing when no payslip carries usage figures", () => {
    const noData = { month: "2026-08-01", isThirteenth: false, status: "verified" };
    expect(leaveTakenByMonth([noData])).toEqual([]);
  });
});
