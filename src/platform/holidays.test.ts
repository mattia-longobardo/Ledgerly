import { describe, expect, it } from "vitest";
import { easterSunday, isBookable, isHoliday, isWeekend, italianHolidays } from "./holidays";

describe("easterSunday", () => {
  it.each([
    [2024, "2024-03-31"],
    [2025, "2025-04-20"],
    [2026, "2026-04-05"],
    [2027, "2027-03-28"],
    [2038, "2038-04-25"],
  ])("computes Easter %i", (year, expected) => {
    expect(easterSunday(year)).toBe(expected);
  });
});

describe("italianHolidays", () => {
  it("lists the national holidays including Easter Monday", () => {
    const dates = italianHolidays(2026).map((h) => h.date);
    expect(dates).toEqual([
      "2026-01-01",
      "2026-01-06",
      "2026-04-05",
      "2026-04-06",
      "2026-04-25",
      "2026-05-01",
      "2026-06-02",
      "2026-08-15",
      "2026-11-01",
      "2026-12-08",
      "2026-12-25",
      "2026-12-26",
    ]);
  });

  it("adds the patron saint and never duplicates a date", () => {
    const milan = italianHolidays(2026, { month: 12, day: 7 });
    expect(milan.find((h) => h.key === "patronSaint")?.date).toBe("2026-12-07");
    const rome = italianHolidays(2026, { month: 6, day: 29 });
    expect(rome).toHaveLength(13);
    const coincides = italianHolidays(2026, { month: 12, day: 8 });
    expect(coincides.filter((h) => h.date === "2026-12-08")).toHaveLength(1);
  });
});

describe("bookable days", () => {
  it("refuses weekends and holidays", () => {
    expect(isWeekend("2026-09-13")).toBe(true);
    expect(isWeekend("2026-09-14")).toBe(false);
    expect(isHoliday("2026-12-25")).toBe(true);
    expect(isHoliday("2026-12-07", { month: 12, day: 7 })).toBe(true);
    expect(isBookable("2026-09-14")).toBe(true);
    expect(isBookable("2026-09-13")).toBe(false);
    expect(isBookable("2026-04-06")).toBe(false);
  });
});
