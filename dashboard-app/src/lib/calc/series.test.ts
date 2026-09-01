import { describe, expect, it } from "vitest";
import type { Series } from "@/lib/contracts";
import { alignSeries, carryForward, deltaOverRange, rangeToMonths } from "./series";

const NOW = new Date("2026-08-15T12:00:00Z");

describe("rangeToMonths", () => {
  it("resolves presets as inclusive windows ending at the current month", () => {
    expect(rangeToMonths("1M", { now: NOW })).toEqual(["2026-08-01"]);
    expect(rangeToMonths("3M", { now: NOW })).toEqual([
      "2026-06-01",
      "2026-07-01",
      "2026-08-01",
    ]);
    expect(rangeToMonths("12M", { now: NOW })).toHaveLength(12);
    expect(rangeToMonths("6M", { now: NOW })[0]).toBe("2026-03-01");
  });

  it("resolves YTD from January of the current year", () => {
    const ytd = rangeToMonths("YTD", { now: NOW });
    expect(ytd[0]).toBe("2026-01-01");
    expect(ytd).toHaveLength(8);
  });

  it("needs an earliest month for ALL", () => {
    expect(rangeToMonths("ALL", { now: NOW, earliest: "2025-11-01" })).toHaveLength(10);
    expect(rangeToMonths("ALL", { now: NOW })).toEqual([]);
  });

  it("accepts a custom range and an explicit month list", () => {
    expect(rangeToMonths({ from: "2026-01-15", to: "2026-03-02" })).toEqual([
      "2026-01-01",
      "2026-02-01",
      "2026-03-01",
    ]);
    expect(rangeToMonths(["2026-03-01", "2026-01-01", "2026-01-20"])).toEqual([
      "2026-01-01",
      "2026-03-01",
    ]);
    expect(rangeToMonths({ from: "2026-03-01", to: "2026-01-01" })).toEqual([]);
  });
});

describe("carryForward", () => {
  it("fills month gaps with the last known value", () => {
    expect(
      carryForward([
        { month: "2026-01-01", value: 100 },
        { month: "2026-04-01", value: 130 },
      ]),
    ).toEqual([
      { month: "2026-01-01", value: 100 },
      { month: "2026-02-01", value: 100 },
      { month: "2026-03-01", value: 100 },
      { month: "2026-04-01", value: 130 },
    ]);
  });

  it("leaves leading gaps null — nothing is known yet", () => {
    expect(
      carryForward([
        { month: "2026-01-01", value: null },
        { month: "2026-02-01", value: 50 },
      ]),
    ).toEqual([
      { month: "2026-01-01", value: null },
      { month: "2026-02-01", value: 50 },
    ]);
    expect(carryForward([])).toEqual([]);
  });
});

describe("alignSeries", () => {
  it("puts every series on one continuous axis with nulls for absences", () => {
    const input: Series[] = [
      { key: "a", label: "A", points: [{ month: "2026-01-01", value: 1 }] },
      { key: "b", label: "B", points: [{ month: "2026-03-01", value: 3 }] },
    ];
    const out = alignSeries(input);
    expect(out[0]?.points).toEqual([
      { month: "2026-01-01", value: 1 },
      { month: "2026-02-01", value: null },
      { month: "2026-03-01", value: null },
    ]);
    expect(out[1]?.points.map((p) => p.value)).toEqual([null, null, 3]);
    expect(out.map((s) => s.key)).toEqual(["a", "b"]);
  });

  it("survives empty input", () => {
    expect(alignSeries([])).toEqual([]);
    expect(alignSeries([{ key: "a", label: "A", points: [] }])).toEqual([
      { key: "a", label: "A", points: [] },
    ]);
  });
});

describe("deltaOverRange", () => {
  const points = [
    { month: "2026-01-01", value: 1000 },
    { month: "2026-02-01", value: null },
    { month: "2026-03-01", value: 1200 },
  ];

  it("compares the latest observed value with the baseline months back", () => {
    expect(deltaOverRange(points, 2)).toEqual({ abs: 200, pct: 20 });
  });

  it("falls back to the last observation at or before the baseline month", () => {
    expect(deltaOverRange(points, 1)).toEqual({ abs: 200, pct: 20 });
  });

  it("returns nulls when there is no baseline", () => {
    expect(deltaOverRange(points, 12)).toEqual({ abs: null, pct: null });
    expect(deltaOverRange([], 3)).toEqual({ abs: null, pct: null });
    expect(deltaOverRange([{ month: "2026-03-01", value: 1200 }], 3)).toEqual({
      abs: null,
      pct: null,
    });
  });

  it("returns a null pct rather than Infinity on a zero baseline", () => {
    const zeroed = [
      { month: "2026-01-01", value: 0 },
      { month: "2026-03-01", value: 500 },
    ];
    expect(deltaOverRange(zeroed, 2)).toEqual({ abs: 500, pct: null });
  });
});
