import { describe, expect, it } from "vitest";
import type { MonthKey } from "@/platform/dates";
import {
  annualisedOverPeriods,
  cumulativeAt,
  forecast,
  fundMetrics,
  monthlyReturns,
  monthlyRhythm,
  periodReturns,
  periodStats,
  returnStats,
  simpleDietz,
} from "./rules";

describe("fundMetrics (spec §7.7)", () => {
  const deposits = [
    { on: "2020-03-01", chargedCents: 500_000n, feeCents: 0n },
    { on: "2026-08-05", chargedCents: 25_100n, feeCents: 100n },
    { on: "2026-09-05", chargedCents: 25_100n, feeCents: 100n },
  ];
  it("adds up paid in, fees and invested, and measures the gain on what was paid in", () => {
    const metrics = fundMetrics(deposits, 600_000n);
    expect(metrics).toMatchObject({
      paidInCents: 550_200n,
      feesCents: 200n,
      investedCents: 550_000n,
      investedPartial: false,
      valueCents: 600_000n,
      gainCents: 49_800n,
    });
    // Ratios are computed in integers to a billionth: more than any display needs.
    expect(metrics.gainFraction).toBeCloseTo(49_800 / 550_200, 8);
  });
  it("does not know the invested amount while a fee is unknown, and the gain without a value", () => {
    const metrics = fundMetrics(
      [...deposits, { on: "2026-09-10", chargedCents: 1_000n, feeCents: null }],
      null,
    );
    expect(metrics).toMatchObject({
      investedCents: 550_000n,
      investedPartial: true,
      gainCents: null,
      gainFraction: null,
    });
  });
  it("has no gain fraction on nothing paid in", () => {
    expect(fundMetrics([], 1_000n).gainFraction).toBeNull();
  });
});

describe("simpleDietz (spec §7.7)", () => {
  it("is (V − Vprev − flows) / (Vprev + flows)", () => {
    // 10.000 → 10.350 with 250 paid in: 100 / 10.250.
    expect(simpleDietz(1_000_000n, 1_035_000n, 25_000n)).toBeCloseTo(100 / 10_250, 8);
    expect(simpleDietz(1_000_000n, 990_000n, 0n)).toBeCloseTo(-0.01, 8);
  });
  it("is unknown without both ends or on nothing invested", () => {
    expect(simpleDietz(null, 1n, 0n)).toBeNull();
    expect(simpleDietz(1n, null, 0n)).toBeNull();
    expect(simpleDietz(0n, 100n, 0n)).toBeNull();
  });
});

describe("monthlyReturns and their statistics", () => {
  it("measures each month from the end of the one before, with that month's deposits", () => {
    const months = ["2026-07-01", "2026-08-01", "2026-09-01"];
    const ends = [1_000_000n, 1_035_000n, null, 1_060_000n]; // June end, then each month's end
    const flows = new Map([["2026-07-01", 25_000n]]);
    const returns = monthlyReturns(months, ends, flows);
    expect(returns[0]).toBeCloseTo(100 / 10_250, 8);
    expect(returns[1]).toBeNull();
    expect(returns[2]).toBeNull();
  });
  it("names the best, the worst, the positive months and the compounded total", () => {
    const stats = returnStats([0.01, -0.02, null, 0.03]);
    expect(stats).toMatchObject({ best: 0.03, worst: -0.02, positive: 2, counted: 3 });
    expect(stats.compounded).toBeCloseTo(1.01 * 0.98 * 1.03 - 1, 12);
    expect(returnStats([null])).toEqual({
      best: null,
      worst: null,
      positive: 0,
      counted: 0,
      compounded: null,
    });
  });
});

describe("cumulativeAt", () => {
  it("is what was paid in by the end of each month", () => {
    const deposits = [
      { on: "2026-07-05", chargedCents: 100n, feeCents: 0n },
      { on: "2026-09-05", chargedCents: 50n, feeCents: 0n },
    ];
    expect(cumulativeAt(deposits, ["2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01"])).toEqual([
      0n,
      100n,
      100n,
      150n,
    ]);
  });
});

describe("a fund younger than the window", () => {
  it("answers unknown for the months it has no end for, instead of reading past the series", () => {
    const months: MonthKey[] = ["2026-07-01", "2026-08-01", "2026-09-01"];
    // Two ends for three months: the third month has no end of its own.
    const returns = monthlyReturns(months, [100_000n, 110_000n], new Map());
    expect(returns).toEqual([0.1, null, null]);
  });
});

describe("where the fund is heading (owner, 2026-09-20)", () => {
  it("projects what will have been paid in, with no value and no rate needed", () => {
    const rows = forecast({
      valueCents: null,
      paidInCents: 100_000n,
      monthlyCents: 20_000n,
      rates: [0.04],
      years: [1, 10],
    });
    expect(rows[0]).toMatchObject({ years: 1, paidInCents: 100_000n + 20_000n * 12n });
    expect(rows[0].valueCents).toEqual([null]);
    expect(rows[1].paidInCents).toBe(100_000n + 20_000n * 120n);
  });

  it("grows the value and each month's payment at the rate given", () => {
    const [row] = forecast({
      valueCents: 100_000n,
      paidInCents: 100_000n,
      monthlyCents: 0n,
      rates: [0, 0.04],
      years: [1],
    });
    // Nothing added: at 0 % the value stands still, at 4 % it is 4 % larger a year later.
    expect(row.valueCents[0]).toBe(100_000n);
    expect(Number(row.valueCents[1])).toBeCloseTo(104_000, -1);

    const [added] = forecast({
      valueCents: 0n,
      paidInCents: 0n,
      monthlyCents: 10_000n,
      rates: [0],
      years: [1],
    });
    // At 0 % a year of payments is exactly the payments.
    expect(added.valueCents[0]).toBe(120_000n);
  });

  it("takes the rhythm from the months, not from the number of payments", () => {
    const months: MonthKey[] = ["2026-01-01", "2026-02-01", "2026-03-01"];
    // One quarterly payment of 660,00 € over three months is 220,00 € a month.
    expect(monthlyRhythm([{ on: "2026-03-20", chargedCents: 66_000n, feeCents: null }], months)).toBe(
      22_000n,
    );
    expect(monthlyRhythm([], months)).toBe(0n);
    // A payment outside the window is not part of the rhythm.
    expect(monthlyRhythm([{ on: "2025-12-31", chargedCents: 66_000n, feeCents: null }], months)).toBe(0n);
  });
});

/*
  The owner's own case, and the number it used to produce: valuations far apart, a quarterly credit
  in between. Holding the last value forward made the credit read as a loss of its own size
  (−59 %) and the next valuation collect every month at once (+150 %). A return needs two
  documented ends (owner, 2026-09-20).
*/
describe("returns between documented values", () => {
  const points = [
    { on: "2026-03-31" as const, cents: 46_000n },
    { on: "2026-06-30" as const, cents: 120_000n },
    { on: "2026-09-01" as const, cents: 225_105n },
  ];
  const flows = [
    { on: "2026-04-20" as const, chargedCents: 66_000n, feeCents: null },
    { on: "2026-07-20" as const, chargedCents: 66_000n, feeCents: null },
  ];

  it("subtracts the money that went in, and keeps each stretch's own dates", () => {
    const [first, second] = periodReturns(points, flows);
    expect(first).toMatchObject({
      from: "2026-03-31",
      to: "2026-06-30",
      days: 91,
      flowsCents: 66_000n,
      // 120 000 − 46 000 − 66 000 = 8 000 on a base of 112 000.
      gainCents: 8_000n,
    });
    expect(first.fraction).toBeCloseTo(8_000 / 112_000, 8);
    expect(second).toMatchObject({ flowsCents: 66_000n, gainCents: 39_105n });
    expect(second.fraction).toBeCloseTo(39_105 / 186_000, 8);
    // Never the numbers the held-forward series produced.
    for (const period of periodReturns(points, flows)) {
      expect(period.fraction).toBeGreaterThan(-0.5);
      expect(period.fraction).toBeLessThan(0.5);
    }
  });

  it("says nothing at all with a single documented value", () => {
    expect(periodReturns([points[0]], flows)).toEqual([]);
    expect(periodStats([])).toMatchObject({ best: null, worst: null, counted: 0, compounded: null });
  });

  it("compounds the stretches and annualises only a year or more of them", () => {
    const periods = periodReturns(points, flows);
    const stats = periodStats(periods);
    expect(stats.counted).toBe(2);
    expect(stats.positive).toBe(2);
    expect(stats.compounded).toBeCloseTo(1.0714285714 * 1.2102419355 - 1, 6);
    // 154 days is not a year.
    expect(annualisedOverPeriods(periods)).toBeNull();
  });
});
