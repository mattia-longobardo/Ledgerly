import { describe, expect, it } from "vitest";
import { cumulativeAt, fundMetrics, monthlyReturns, returnStats, simpleDietz } from "./rules";

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
