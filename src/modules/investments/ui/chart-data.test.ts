import { describe, expect, it } from "vitest";
import { asReturns, percentAxisLabels, returnScale, runningTotal } from "./chart-data";

describe("the Return view of the P&L chart", () => {
  it("makes the bars add up to the period's rate", () => {
    // 300,00 of P&L at 6 %: the average capital is 5.000,00, and each bar is its P&L over it.
    const bars = [10_000n, -5_000n, null, 25_000n];
    const scale = returnScale(30_000n, 0.06)!;
    const shares = asReturns(bars, scale);
    expect(shares[0]).toBeCloseTo(0.02, 10);
    expect(shares[1]).toBeCloseTo(-0.01, 10);
    expect(shares[2]).toBeNull();
    expect(shares[3]).toBeCloseTo(0.05, 10);
    expect(asReturns(runningTotal(bars), scale).at(-1)).toBeCloseTo(0.06, 10);
  });

  it("keeps the sign of a loss: a negative P&L at a negative rate is a positive capital", () => {
    const scale = returnScale(-20_000n, -0.04)!;
    expect(asReturns([-20_000n, 5_000n], scale)).toEqual([-0.04, 0.01]);
  });

  it("has nothing to draw without a rate, or without a P&L to read the capital from", () => {
    expect(returnScale(null, 0.05)).toBeNull();
    expect(returnScale(10_000n, null)).toBeNull();
    expect(returnScale(0n, 0.05)).toBeNull();
    expect(returnScale(10_000n, 0)).toBeNull();
  });

  it("labels the axis in percent, top to bottom, with zero always in range", () => {
    const plain = (labels: string[]) => labels.map((label) => label.replace(/\s/g, " "));
    expect(plain(percentAxisLabels([0.03, null, 0.06], "it-IT", 3))).toEqual(["+6,0 %", "+3,0 %", "0,0 %"]);
    expect(plain(percentAxisLabels([-0.02, 0.02], "it-IT", 3))).toEqual(["+2,0 %", "0,0 %", "−2,0 %"]);
  });
});
