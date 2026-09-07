import { describe, expect, it } from "vitest";
import {
  annualTotals,
  averageNet,
  averageTaxes,
  isThirteenthCandidate,
  netPerMonthSeries,
  ral,
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
