import { describe, expect, it } from "vitest";
import { barIntervals, legacyPeriodQuery, periodQuery, periodSpan, valueDays, yearsOf } from "./period";
import { periodOf } from "./pnl";

const TODAY = "2026-10-29";

describe("legacyPeriodQuery (§1.2)", () => {
  it("leaves a new address alone", () => {
    expect(legacyPeriodQuery({}, TODAY)).toBeNull();
    expect(legacyPeriodQuery({ period: "2025", view: "value" }, TODAY)).toBeNull();
    expect(legacyPeriodQuery({ from: "2026-06-10", to: "2026-09-30" }, TODAY)).toBeNull();
  });

  it("sends each preset to the nearest period", () => {
    expect(legacyPeriodQuery({ range: "1y" }, TODAY)).toEqual({});
    expect(legacyPeriodQuery({ range: "all" }, TODAY)).toEqual({ period: "all" });
    expect(legacyPeriodQuery({ range: "3m" }, TODAY)).toEqual({ from: "2026-08-01", to: TODAY });
    expect(legacyPeriodQuery({ range: "nonsense" }, TODAY)).toEqual({});
  });

  it("turns months into their first and last day, in order", () => {
    expect(legacyPeriodQuery({ from: "2025-01", to: "2025-03" }, TODAY)).toEqual({
      from: "2025-01-01",
      to: "2025-03-31",
    });
    expect(legacyPeriodQuery({ from: "2024-02", to: "2023-11" }, TODAY)).toEqual({
      from: "2023-11-01",
      to: "2024-02-29",
    });
  });

  it("drops the grain and keeps every other parameter", () => {
    expect(legacyPeriodQuery({ grain: "day", view: "value", by: "ccy" }, TODAY)).toEqual({
      view: "value",
      by: "ccy",
    });
    expect(legacyPeriodQuery({ grain: "day", period: "2025" }, TODAY)).toEqual({ period: "2025" });
    expect(legacyPeriodQuery({ grain: "month", from: "2026-06-10", to: "2026-09-30" }, TODAY)).toEqual({
      from: "2026-06-10",
      to: "2026-09-30",
    });
    expect(legacyPeriodQuery({ range: ["all", "1y"], grain: "day", from: "2025-01" }, TODAY)).toEqual({
      period: "all",
    });
  });

  it("lands on a period periodOf reads as the one meant", () => {
    const read = (query: Record<string, string>) => periodOf(legacyPeriodQuery(query, TODAY)!, TODAY);
    expect(read({ range: "1y" })).toMatchObject({ kind: "year", year: 2026 });
    expect(read({ range: "all", grain: "day" })).toMatchObject({ kind: "all" });
    expect(read({ from: "2025-01", to: "2025-12" })).toMatchObject({
      kind: "custom",
      from: "2025-01-01",
      to: "2025-12-31",
    });
  });
});

describe("periodQuery", () => {
  it("writes a period back as the parameters that ask for it", () => {
    for (const query of [
      {},
      { period: "2025" },
      { period: "all" },
      { from: "2026-06-10", to: "2026-09-30" },
    ]) {
      expect(periodQuery(periodOf(query, TODAY), TODAY)).toEqual(query);
    }
  });
});

describe("periodSpan and yearsOf", () => {
  it("starts All and a year on the first day with data", () => {
    expect(periodSpan(periodOf({ period: "all" }, TODAY), "2024-10-28")).toEqual({
      from: "2024-10-28",
      to: TODAY,
    });
    expect(periodSpan(periodOf({}, TODAY), "2026-06-10")).toEqual({ from: "2026-06-10", to: TODAY });
    expect(periodSpan(periodOf({}, TODAY), "2024-10-28")).toEqual({ from: "2026-01-01", to: TODAY });
    expect(periodSpan(periodOf({ period: "all" }, TODAY), null)).toEqual({ from: TODAY, to: TODAY });
  });

  it("keeps a custom range as written and a year before the data at one day", () => {
    expect(periodSpan(periodOf({ from: "2024-01-01", to: "2024-03-31" }, TODAY), "2024-10-28")).toEqual({
      from: "2024-01-01",
      to: "2024-03-31",
    });
    expect(periodSpan(periodOf({ period: "2023" }, TODAY), "2024-10-28")).toEqual({
      from: "2023-12-31",
      to: "2023-12-31",
    });
  });

  it("walks from the first year with data to the year running", () => {
    expect(yearsOf("2024-10-28", TODAY)).toEqual({ first: 2024, last: 2026 });
    expect(yearsOf(null, TODAY)).toEqual({ first: 2026, last: 2026 });
  });
});

describe("barIntervals and valueDays (§2.2)", () => {
  it("goes by week up to 92 days, Monday to Sunday", () => {
    const { grain, intervals } = barIntervals("2026-08-01", TODAY);
    expect(grain).toBe("week");
    // 1 August 2026 is a Saturday: the first week is cut to it and the Sunday.
    expect(intervals[0]).toEqual({ from: "2026-08-01", to: "2026-08-02" });
    expect(intervals[1]).toEqual({ from: "2026-08-03", to: "2026-08-09" });
    expect(intervals.at(-1)).toEqual({ from: "2026-10-26", to: TODAY });
  });

  it("goes by month up to a leap year, by year past it", () => {
    const year = barIntervals("2026-01-01", TODAY);
    expect(year.grain).toBe("month");
    expect(year.intervals).toHaveLength(10);
    expect(year.intervals[1]).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(year.intervals.at(-1)).toEqual({ from: "2026-10-01", to: TODAY });
    expect(barIntervals("2024-01-01", "2024-12-31").grain).toBe("month");

    const all = barIntervals("2024-10-28", TODAY);
    expect(all.grain).toBe("year");
    expect(all.intervals).toEqual([
      { from: "2024-10-28", to: "2024-12-31" },
      { from: "2025-01-01", to: "2025-12-31" },
      { from: "2026-01-01", to: TODAY },
    ]);
  });

  it("covers the span with no hole and no overlap", () => {
    for (const from of ["2026-10-29", "2026-09-01", "2025-11-15", "2021-03-03"]) {
      const { intervals } = barIntervals(from, TODAY);
      expect(intervals[0].from).toBe(from);
      expect(intervals.at(-1)!.to).toBe(TODAY);
      for (let index = 1; index < intervals.length; index += 1) {
        expect(intervals[index].from > intervals[index - 1].to).toBe(true);
        expect(intervals[index - 1].from <= intervals[index - 1].to).toBe(true);
      }
    }
  });

  it("values every day up to 92 days, else each month end and today", () => {
    expect(valueDays("2026-10-27", TODAY)).toEqual({
      grain: "day",
      days: ["2026-10-27", "2026-10-28", TODAY],
    });
    const year = valueDays("2026-01-01", TODAY);
    expect(year.grain).toBe("month");
    expect(year.days[0]).toBe("2026-01-31");
    expect(year.days.at(-1)).toBe(TODAY);
    expect(year.days).toHaveLength(10);
  });
});
