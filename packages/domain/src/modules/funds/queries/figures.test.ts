import { describe, expect, it } from "vitest";
import type { Operation } from "../pension/operations";
import { gainChart, recentOperations, registerTotals, voluntaryCents } from "./figures";

const operation = (overrides: Partial<Operation>): Operation =>
  ({
    id: "op",
    classification: "contribution",
    workerCents: 0n,
    employerCents: 0n,
    tfrCents: 0n,
    otherCents: 0n,
    feesCents: 0n,
    netCents: 0n,
    ...overrides,
  }) as Operation;

describe("the gain chart's figures", () => {
  it("runs the total over the gaps and finds the best and the worst bar", () => {
    const chart = gainChart([100n, null, -50n, 200n], 250n, 0.05);
    expect(chart.cumulative).toEqual([100n, null, 50n, 250n]);
    expect([chart.best, chart.worst]).toEqual([3, 2]);
    expect(chart.scale).toBeCloseTo(0.05 / 250);
  });

  it("has no extremes without a bar, and no scale without a rate or a gain", () => {
    expect(gainChart([null, null], null, null)).toEqual({
      cumulative: [null, null],
      best: null,
      worst: null,
      scale: null,
    });
    expect(gainChart([10n], 0n, 0.01).scale).toBeNull();
    expect(gainChart([10n], 10n, null).scale).toBeNull();
  });
});

describe("the register's figures", () => {
  const rows = [
    operation({ workerCents: 100n, employerCents: 50n, tfrCents: 200n, feesCents: 3n, netCents: 347n }),
    operation({ classification: "voluntary", workerCents: 500n, netCents: 500n }),
    operation({ classification: "withdrawal", otherCents: 300n, netCents: -300n }),
  ];

  it("keeps the voluntary payments out of the payslip's parts, and an exit negative", () => {
    expect(registerTotals(rows)).toEqual({
      workerCents: 100n,
      employerCents: 50n,
      tfrCents: 200n,
      voluntaryCents: 500n,
      otherCents: -300n,
      feesCents: 3n,
      netCents: 547n,
    });
    expect(voluntaryCents(rows)).toBe(500n);
  });

  it("lists the last operations that moved money, newest first", () => {
    const moved = [
      operation({ id: "a", workerCents: 1n }),
      operation({ id: "b" }),
      operation({ id: "c", otherCents: 2n }),
    ];
    expect(recentOperations(moved).map((one) => one.id)).toEqual(["c", "a"]);
    expect(recentOperations(moved, 1).map((one) => one.id)).toEqual(["c"]);
  });
});
