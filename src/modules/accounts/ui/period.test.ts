import { describe, expect, it } from "vitest";
import { parsePeriodQuery, periodEnd, periodMonths } from "./period";

const TODAY = "2026-11-13";

describe("parsePeriodQuery (PERS-342: the Expenses control on Overview and Accounts)", () => {
  it("opens on this month, drawn day by day", () => {
    const period = parsePeriodQuery({}, TODAY);
    expect(period).toMatchObject({
      preset: "thisMonth",
      offset: 0,
      range: { from: "2026-11-01", to: "2026-11-30" },
      grain: "day",
      params: {},
    });
  });

  it("takes a preset and steps it back by its own length", () => {
    const period = parsePeriodQuery({ preset: "last3Months", off: "1" }, TODAY);
    expect(period.range).toEqual({ from: "2026-06-01", to: "2026-08-31" });
    expect(period.grain).toBe("month");
    expect(period.params).toEqual({ preset: "last3Months", off: "1" });
    expect(period.stepperParams).toEqual({ preset: "last3Months" });
  });

  it("a range the picker wrote wins over the preset; the grain the address chose wins", () => {
    const period = parsePeriodQuery(
      { preset: "ytd", from: "2026-01-10", to: "2026-02-05", chart: "month" },
      TODAY,
      "chart",
    );
    expect(period.preset).toBeNull();
    expect(period.range).toEqual({ from: "2026-01-10", to: "2026-02-05" });
    expect(period.grain).toBe("month");
    expect(period.params).toEqual({ from: "2026-01-10", to: "2026-02-05", chart: "month" });
  });

  it("falls back to the default on an address it cannot read, as the old 3M / 1Y links", () => {
    expect(parsePeriodQuery({ range: "1y", from: "2026-01", to: "2026-03", off: "x" }, TODAY)).toMatchObject({
      preset: "thisMonth",
      offset: 0,
    });
  });
});

describe("the window of a period", () => {
  it("ends today while the period is running, and counts its months up to then", () => {
    const range = { from: "2026-01-01", to: "2026-11-30" };
    expect(periodEnd(range, TODAY)).toBe(TODAY);
    expect(periodMonths(range, TODAY)).toEqual({ months: 11, through: "2026-11-01" });
    expect(periodMonths({ from: "2026-06-01", to: "2026-08-31" }, TODAY)).toEqual({
      months: 3,
      through: "2026-08-01",
    });
  });
});
