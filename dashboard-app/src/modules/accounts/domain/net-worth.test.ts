import { describe, expect, it } from "vitest";
import { monthlySeries, totalSeries } from "./net-worth";

const p = (asOf: string, balance: string) => ({
  accountId: "a", asOf, balance, available: null, source: "manual" as const, capturedAt: new Date(`${asOf}T12:00:00Z`),
});

describe("monthlySeries", () => {
  it("takes the last balance of each month and carries forward gaps", () => {
    const s = monthlySeries(
      [p("2026-01-05", "10.00"), p("2026-01-20", "12.50"), p("2026-03-01", "20.00")],
      ["2026-01-01", "2026-02-01", "2026-03-01"],
    );
    expect(s).toEqual([
      { month: "2026-01-01", value: 12.5 },
      { month: "2026-02-01", value: 12.5 },
      { month: "2026-03-01", value: 20 },
    ]);
  });
  it("is null before the first known value", () => {
    expect(monthlySeries([p("2026-02-01", "5.00")], ["2026-01-01", "2026-02-01"])[0]?.value).toBeNull();
  });
  it("carries a seed from before the window into every month", () => {
    const s = monthlySeries([], ["2026-01-01", "2026-02-01"], p("2025-11-14", "40.00"));
    expect(s).toEqual([
      { month: "2026-01-01", value: 40 },
      { month: "2026-02-01", value: 40 },
    ]);
  });
  it("lets the first in-window balance override the seed from that month on", () => {
    const s = monthlySeries([p("2026-02-03", "7.00")], ["2026-01-01", "2026-02-01"], p("2025-11-14", "40.00"));
    expect(s).toEqual([
      { month: "2026-01-01", value: 40 },
      { month: "2026-02-01", value: 7 },
    ]);
  });
  it("ignores a seed that is not older than the window", () => {
    const s = monthlySeries([], ["2026-01-01", "2026-02-01"], p("2026-01-05", "40.00"));
    expect(s[0]?.value).toBeNull();
  });
});

describe("totalSeries", () => {
  it("sums per-month values in cents and keeps null when nothing is known", () => {
    const t = totalSeries(
      [
        [{ month: "2026-01-01", value: 0.1 }, { month: "2026-02-01", value: 0.2 }],
        [{ month: "2026-01-01", value: null }, { month: "2026-02-01", value: 0.1 }],
      ],
      ["2026-01-01", "2026-02-01"],
    );
    expect(t).toEqual([{ month: "2026-01-01", value: 0.1 }, { month: "2026-02-01", value: 0.3 }]);
  });
});
