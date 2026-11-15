import { describe, expect, it } from "vitest";
import {
  barIntervals,
  legacyPeriodQuery,
  periodQuery,
  periodSpan,
  sectionPeriod,
  valueDays,
  yearQuery,
  yearsOf,
} from "./period";
import { periodOf } from "./pnl";

const TODAY = "2026-10-29";

describe("legacyPeriodQuery (§1.2)", () => {
  it("leaves a new address alone", () => {
    expect(legacyPeriodQuery({}, TODAY)).toBeNull();
    expect(legacyPeriodQuery({ off: "1", view: "value" }, TODAY)).toBeNull();
    expect(legacyPeriodQuery({ preset: "all" }, TODAY)).toBeNull();
    expect(legacyPeriodQuery({ from: "2026-06-10", to: "2026-09-30" }, TODAY)).toBeNull();
  });

  it("sends each preset to the nearest period", () => {
    expect(legacyPeriodQuery({ range: "1y" }, TODAY)).toEqual({});
    expect(legacyPeriodQuery({ range: "all" }, TODAY)).toEqual({ preset: "all" });
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
    expect(legacyPeriodQuery({ grain: "day", period: "2025" }, TODAY)).toEqual({ off: "1" });
    expect(legacyPeriodQuery({ grain: "month", from: "2026-06-10", to: "2026-09-30" }, TODAY)).toEqual({
      from: "2026-06-10",
      to: "2026-09-30",
    });
    expect(legacyPeriodQuery({ range: ["all", "1y"], grain: "day", from: "2025-01" }, TODAY)).toEqual({
      preset: "all",
    });
  });

  it("sends the period before the presets to the new one: a year, All, the year running", () => {
    expect(legacyPeriodQuery({ period: "2025", view: "value" }, TODAY)).toEqual({ view: "value", off: "1" });
    expect(legacyPeriodQuery({ period: "2024" }, TODAY)).toEqual({ off: "2" });
    expect(legacyPeriodQuery({ period: "all", by: "ccy" }, TODAY)).toEqual({ by: "ccy", preset: "all" });
    expect(legacyPeriodQuery({ period: "2026" }, TODAY)).toEqual({});
    expect(legacyPeriodQuery({ period: "nonsense" }, TODAY)).toEqual({});
  });

  it("lands on a period periodOf reads as the one meant", () => {
    const read = (query: Record<string, string>) =>
      sectionPeriod(legacyPeriodQuery(query, TODAY)!, TODAY).period;
    expect(read({ range: "1y" })).toMatchObject({ kind: "year", year: 2026 });
    expect(read({ range: "all", grain: "day" })).toMatchObject({ kind: "all" });
    expect(read({ period: "2025" })).toMatchObject({ kind: "year", year: 2025, to: "2025-12-31" });
    expect(read({ from: "2025-01", to: "2025-03" })).toMatchObject({
      kind: "custom",
      from: "2025-01-01",
      to: "2025-03-31",
    });
  });
});

describe("sectionPeriod: the period of Funds and Investments, read as Expenses reads its own", () => {
  it("opens on the year running, which the engines measure as a year up to today", () => {
    const section = sectionPeriod({}, TODAY);
    expect(section).toMatchObject({
      preset: "ytd",
      offset: 0,
      range: { from: "2026-01-01", to: "2026-10-31" },
      params: {},
    });
    expect(section.period).toEqual(periodOf({}, TODAY));
  });

  it("reads the four presets of Expenses as their days, up to today", () => {
    expect(sectionPeriod({ preset: "thisMonth" }, TODAY)).toMatchObject({
      preset: "thisMonth",
      range: { from: "2026-10-01", to: "2026-10-31" },
      period: { kind: "custom", from: "2026-10-01", to: TODAY },
    });
    expect(sectionPeriod({ preset: "lastMonth" }, TODAY).period).toMatchObject({
      kind: "custom",
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(sectionPeriod({ preset: "last3Months", off: "1" }, TODAY)).toMatchObject({
      offset: 1,
      range: { from: "2026-05-01", to: "2026-07-31" },
      params: { preset: "last3Months", off: "1" },
      stepperParams: { preset: "last3Months" },
    });
  });

  it("steps the year to date by calendar year: the one before is the whole year before", () => {
    const before = sectionPeriod({ off: "1" }, TODAY);
    expect(before.range).toEqual({ from: "2025-01-01", to: "2025-12-31" });
    expect(before.period).toEqual(periodOf({ period: "2025" }, TODAY));
    expect(sectionPeriod({ off: "2" }, TODAY).period).toMatchObject({ kind: "year", year: 2024 });
  });

  it("has All, with no window and no step", () => {
    expect(sectionPeriod({ preset: "all", off: "3" }, TODAY)).toMatchObject({
      preset: "all",
      offset: 0,
      range: null,
      params: { preset: "all" },
      period: { kind: "all", from: null, to: TODAY },
    });
  });

  it("lets the days the picker wrote win over a preset; a whole year is a year", () => {
    expect(sectionPeriod({ preset: "all", from: "2026-06-10", to: "2026-09-30" }, TODAY)).toMatchObject({
      preset: null,
      period: { kind: "custom", from: "2026-06-10", to: "2026-09-30" },
      params: { from: "2026-06-10", to: "2026-09-30" },
    });
    expect(sectionPeriod({ from: "2025-01-01", to: "2025-12-31" }, TODAY).period).toMatchObject({
      kind: "year",
      year: 2025,
    });
  });

  it("falls back to the default on anything it cannot read", () => {
    for (const query of [
      { preset: "nonsense" },
      { from: "2027-01-01", to: "2027-02-01" },
      { from: "2026-09-30", to: "2026-06-10" },
      { off: "-4" },
    ]) {
      expect(sectionPeriod(query, TODAY)).toMatchObject({ preset: "ytd", offset: 0 });
    }
  });
});

describe("periodQuery and yearQuery", () => {
  it("writes a period back as the parameters that ask for it", () => {
    for (const query of [{}, { off: "1" }, { preset: "all" }, { from: "2026-06-10", to: "2026-09-30" }]) {
      expect(periodQuery(sectionPeriod(query, TODAY).period, TODAY)).toEqual(query);
    }
  });

  it("asks for a year as steps back from the year running", () => {
    expect(yearQuery(2026, TODAY)).toEqual({});
    expect(yearQuery(2024, TODAY)).toEqual({ off: "2" });
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
