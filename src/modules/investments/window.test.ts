import { describe, expect, it } from "vitest";
import { chartDays, DAY_POINTS } from "./window";

const TODAY = "2026-10-28";

describe("chartDays (PERS-100)", () => {
  it("shows the last year by default, one month end per month and today for this one", () => {
    const { months, days } = chartDays({ grain: "month", range: null, custom: null }, TODAY, "2024-10-28");
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("2025-11-01");
    expect(days[0]).toBe("2025-11-30");
    expect(days.at(-1)).toBe(TODAY);
  });

  it("starts where the history starts: All, and a preset reaching past it", () => {
    expect(
      chartDays({ grain: "month", range: "all", custom: null }, TODAY, "2024-10-28").months,
    ).toHaveLength(25);
    expect(chartDays({ grain: "month", range: "1y", custom: null }, TODAY, "2026-06-10").months[0]).toBe(
      "2026-06-01",
    );
    // A service born today still has one point.
    expect(chartDays({ grain: "month", range: "all", custom: null }, TODAY, TODAY).days).toEqual([TODAY]);
  });

  it("reads the months the picker wrote", () => {
    const { months, days } = chartDays(
      { grain: "month", range: null, custom: { from: "2025-01-01", to: "2025-03-01" } },
      TODAY,
      "2024-10-28",
    );
    expect(months).toEqual(["2025-01-01", "2025-02-01", "2025-03-01"]);
    expect(days).toEqual(["2025-01-31", "2025-02-28", "2025-03-31"]);
  });

  it("gives every day at day grain, at most the last 366, never before the history", () => {
    const all = chartDays({ grain: "day", range: "all", custom: null }, TODAY, "2024-10-28").days;
    expect(all).toHaveLength(DAY_POINTS);
    expect(all.at(-1)).toBe(TODAY);
    const young = chartDays({ grain: "day", range: "1y", custom: null }, TODAY, "2026-10-20").days;
    expect(young).toEqual([
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
      "2026-10-26",
      "2026-10-27",
      TODAY,
    ]);
    const march = chartDays(
      { grain: "day", range: null, custom: { from: "2025-03-01", to: "2025-03-01" } },
      TODAY,
      "2024-10-28",
    ).days;
    expect([march[0], march.at(-1), march.length]).toEqual(["2025-03-01", "2025-03-31", 31]);
  });
});
