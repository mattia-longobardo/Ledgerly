import { describe, expect, it } from "vitest";
import { chartGrain, yearPeriod } from "./period";

describe("chartGrain (FND-8): one pair of thresholds, the short grain of each page", () => {
  it("goes by the short grain up to a quarter, by month up to a year, by year past it", () => {
    expect(chartGrain(92, "week")).toBe("week");
    expect(chartGrain(92, "stretch")).toBe("stretch");
    expect(chartGrain(93, "week")).toBe("month");
    expect(chartGrain(366, "stretch")).toBe("month");
    expect(chartGrain(367, "week")).toBe("year");
  });
});

describe("yearPeriod (FND-7): the one year to date", () => {
  it("ends today while the year runs, on 31 December after", () => {
    expect(yearPeriod(2026, "2026-11-21")).toEqual({ from: "2026-01-01", to: "2026-11-21" });
    expect(yearPeriod(2025, "2026-11-21")).toEqual({ from: "2025-01-01", to: "2025-12-31" });
  });
});
