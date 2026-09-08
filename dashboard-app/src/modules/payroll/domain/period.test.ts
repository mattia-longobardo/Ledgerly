import { describe, expect, it } from "vitest";
import { monthOfPeriod, periodFor, recordKindOf, titleIsThirteenth, titleMonth } from "./period";

describe("titleMonth", () => {
  it("reads the Italian month name and year out of a payslip title", () => {
    expect(titleMonth("Busta Paga Agosto 2026")).toBe("2026-08-01");
    expect(titleMonth("busta paga - maggio 2026")).toBe("2026-05-01");
    expect(titleMonth("Cedolino Dicembre 2025")).toBe("2025-12-01");
  });

  it("files a tredicesima with no month name in December of its year", () => {
    expect(titleMonth("Tredicesima 2025")).toBe("2025-12-01");
  });

  it("answers null when there is nothing to read", () => {
    expect(titleMonth(null)).toBeNull();
    expect(titleMonth(undefined)).toBeNull();
    expect(titleMonth("scan_0001.pdf")).toBeNull();
  });
});

describe("titleIsThirteenth", () => {
  it("recognises every spelling the employer uses", () => {
    expect(titleIsThirteenth("Tredicesima 2025")).toBe(true);
    expect(titleIsThirteenth("Busta paga 13ª 2025")).toBe(true);
    expect(titleIsThirteenth("Gratifica natalizia 2025")).toBe(true);
  });

  it("is false for an ordinary December payslip", () => {
    expect(titleIsThirteenth("Busta Paga Dicembre 2025")).toBe(false);
    expect(titleIsThirteenth(null)).toBe(false);
  });
});

describe("periodFor", () => {
  it("turns a month key into the civil month's first and last day", () => {
    expect(periodFor("2026-08-01")).toEqual({ periodStart: "2026-08-01", periodEnd: "2026-08-31" });
    expect(periodFor("2026-02-01")).toEqual({ periodStart: "2026-02-01", periodEnd: "2026-02-28" });
  });

  it("gets February right in a leap year", () => {
    expect(periodFor("2028-02-01")).toEqual({ periodStart: "2028-02-01", periodEnd: "2028-02-29" });
  });

  it("normalises a mid-month date to its month", () => {
    expect(periodFor("2026-08-17")).toEqual({ periodStart: "2026-08-01", periodEnd: "2026-08-31" });
  });

  it("throws on a value that is not a date, rather than inventing a period", () => {
    expect(() => periodFor("not-a-date")).toThrow(/invalid month key/i);
  });
});

describe("recordKindOf", () => {
  it("maps the tredicesima flag onto the record kind the schema allows", () => {
    expect(recordKindOf(true)).toBe("thirteenth");
    expect(recordKindOf(false)).toBe("ordinary");
  });
});

describe("monthOfPeriod", () => {
  it("is the inverse of periodFor's start", () => {
    expect(monthOfPeriod("2026-08-01")).toBe("2026-08-01");
    expect(monthOfPeriod("2026-08-31")).toBe("2026-08-01");
  });
});
