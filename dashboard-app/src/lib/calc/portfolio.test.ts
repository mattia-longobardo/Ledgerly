import { describe, expect, it } from "vitest";
import { combinedGain, fundGain, type FundSeries } from "./portfolio";

/**
 * The owner's real 2026 series, straight from `balance_snapshots`. A recorded
 * value is the position at the end of the month before it, so credits are keyed
 * by the month they become visible: the 20/01 payment shows in February, 13/04
 * in May, 16/07 in August. The net credits (530,12 / 818,41 / 825,21) and the
 * 3.000 € opening capital are exactly what the fund cards divide by, so the euro
 * columns here must reconcile with the cards to the cent.
 */
const cometa: FundSeries = {
  key: "cometa",
  label: "Fondo Cometa",
  initialCapital: 0,
  values: [
    { month: "2026-01-01", value: 543.44 },
    { month: "2026-02-01", value: 543.44 },
    { month: "2026-03-01", value: 540.46 },
    { month: "2026-04-01", value: 547.02 },
    { month: "2026-05-01", value: 1368.88 },
    { month: "2026-06-01", value: 1407.21 },
    { month: "2026-07-01", value: 1414.45 },
    { month: "2026-08-01", value: 2228.13 },
    { month: "2026-09-01", value: 2228.13 },
  ],
  credited: new Map([
    ["2026-02-01", 530.12],
    ["2026-05-01", 818.41],
    ["2026-08-01", 825.21],
  ]),
};

const fideuram: FundSeries = {
  key: "fideuram",
  label: "Fideuram",
  initialCapital: 3000,
  values: [
    { month: "2026-01-01", value: 3000.0 },
    { month: "2026-02-01", value: 3252.0 },
    { month: "2026-03-01", value: 3528.14 },
    { month: "2026-04-01", value: 3672.09 },
    { month: "2026-05-01", value: 4042.21 },
    { month: "2026-06-01", value: 4390.17 },
    { month: "2026-07-01", value: 4657.72 },
    { month: "2026-08-01", value: 4884.25 },
    { month: "2026-09-01", value: 5174.54 },
  ],
  // Monthly 250 €, shifted one month to the value it first shows up in.
  credited: new Map([
    ["2026-02-01", 250],
    ["2026-03-01", 250],
    ["2026-04-01", 250],
    ["2026-05-01", 250],
    ["2026-06-01", 250],
    ["2026-07-01", 250],
    ["2026-08-01", 250],
    ["2026-09-01", 250],
  ]),
};

const sumAbs = (rows: { abs: number | null }[]) =>
  Number(rows.reduce((s, r) => s + (r.abs ?? 0), 0).toFixed(2));
const sumPaid = (rows: { paidIn: number }[]) =>
  Number(rows.reduce((s, r) => s + r.paidIn, 0).toFixed(2));

describe("fundGain — Fideuram (monthly, opening capital)", () => {
  const g = fundGain(fideuram);
  const at = (month: string) => g.rows.find((r) => r.month === month)!;

  it("starts in January, the month the opening capital is funded", () => {
    expect(g.rows[0]!.month).toBe("2026-01-01");
    expect(g.rows[0]!.opening).toBe(true);
    expect(g.rows[0]!.paidIn).toBe(3000);
    expect(g.rows[0]!.abs).toBe(0); // value equals the capital, no gain yet
    expect(g.rows[0]!.pct).toBeNull();
  });

  it("scores each month as value change less what was paid in", () => {
    expect(at("2026-02-01").abs).toBeCloseTo(2.0, 2);
    expect(at("2026-03-01").abs).toBeCloseTo(26.14, 2);
    expect(at("2026-04-01").abs).toBeCloseTo(-106.05, 2);
    expect(at("2026-03-01").pct).toBeCloseTo(0.75, 2);
    expect(at("2026-04-01").pct).toBeCloseTo(-2.81, 2);
  });

  it("euro column sums to the card's lifetime gain of 174,54", () => {
    expect(sumAbs(g.rows)).toBe(174.54);
    expect(g.total.abs).toBe(174.54);
  });

  it("paid-in column sums to the card's 5.000 deposited", () => {
    expect(sumPaid(g.rows)).toBe(5000);
  });
});

describe("fundGain — Cometa (quarterly, no opening capital)", () => {
  const g = fundGain(cometa);
  const at = (month: string) => g.rows.find((r) => r.month === month)!;

  it("starts in February, when the first quarter is credited and a base exists", () => {
    // January has a value (543,44) but nothing credited yet, so there is no
    // funded position to score — the table opens in February.
    expect(g.rows[0]!.month).toBe("2026-02-01");
    expect(g.rows.some((r) => r.month === "2026-01-01")).toBe(false);
    expect(g.rows[0]!.opening).toBe(true);
    expect(g.rows[0]!.paidIn).toBeCloseTo(530.12, 2);
  });

  it("reproduces the real monthly percentages", () => {
    expect(at("2026-03-01").pct).toBeCloseTo(-0.55, 2);
    expect(at("2026-05-01").pct).toBeCloseTo(0.25, 2);
    expect(at("2026-06-01").pct).toBeCloseTo(2.8, 2);
    expect(at("2026-08-01").pct).toBeCloseTo(-0.51, 2);
  });

  it("holds a quarterly credit out of the gain of the month it appears in", () => {
    expect(at("2026-05-01").paidIn).toBeCloseTo(818.41, 2);
    expect(at("2026-08-01").paidIn).toBeCloseTo(825.21, 2);
  });

  it("euro column sums to the card's lifetime gain of 54,39", () => {
    expect(sumAbs(g.rows)).toBe(54.39);
    expect(g.total.abs).toBe(54.39);
  });

  it("paid-in column sums to the card's 2.173,74 deposited", () => {
    expect(sumPaid(g.rows)).toBe(2173.74);
  });
});

describe("combinedGain across both funds", () => {
  const { perFund, combined, combinedTotal } = combinedGain([fideuram, cometa]);
  const at = (month: string) => combined.find((r) => r.month === month)!;

  it("keeps each fund's own total equal to its card", () => {
    expect(perFund.find((f) => f.key === "fideuram")!.total.abs).toBe(174.54);
    expect(perFund.find((f) => f.key === "cometa")!.total.abs).toBe(54.39);
  });

  it("combined euro total is the two cards added: 228,93", () => {
    expect(combinedTotal.abs).toBe(228.93);
    expect(sumAbs(combined)).toBe(228.93);
  });

  it("spans the whole year from January, not March", () => {
    expect(combined[0]!.month).toBe("2026-01-01");
    expect(combined.at(-1)!.month).toBe("2026-09-01");
  });

  it("scores the combined percentage only once both funds are past opening", () => {
    // January (Cometa not started) and February (Cometa opening) are unscored.
    expect(at("2026-01-01").pct).toBeNull();
    expect(at("2026-02-01").pct).toBeNull();
    // March onward matches the portfolio simple-Dietz the owner already saw.
    expect(at("2026-03-01").pct).toBeCloseTo(0.57, 2);
    expect(at("2026-04-01").pct).toBeCloseTo(-2.3, 2);
    expect(at("2026-09-01").pct).toBeCloseTo(0.55, 2);
  });

  it("combined paid-in is the sum of both funds' months", () => {
    expect(sumPaid(combined)).toBe(7173.74); // 5000 + 2173,74
  });

  it("compounds the combined percentage rather than adding it", () => {
    expect(combinedTotal.pct).toBeCloseTo(3.45, 1);
  });
});

describe("edge cases", () => {
  it("returns nothing for a fund that has never been funded", () => {
    const g = fundGain({
      key: "x",
      label: "X",
      initialCapital: 0,
      values: [{ month: "2026-01-01", value: 100 }],
      credited: new Map(),
    });
    expect(g.rows).toEqual([]);
    expect(g.total).toEqual({ abs: 0, pct: null });
  });

  it("handles an empty fund list", () => {
    expect(combinedGain([])).toEqual({ perFund: [], combined: [], combinedTotal: { abs: 0, pct: null } });
  });
});
