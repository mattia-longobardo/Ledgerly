import { describe, expect, it } from "vitest";
import type { MonthKey } from "../../shared/dates";
import { annualisedOverPeriods, forecast, monthlyRhythm, periodReturns, periodStats } from "./rules";

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
