import { describe, expect, it } from "vitest";
import { pensionCompetenceOf } from "./pension";

type Row = Parameters<typeof pensionCompetenceOf>[0];

const row = (type: Row["type"], printedOn: string | null): Row => ({
  id: "p",
  period: null,
  type,
  year: 2026,
  printedOn,
  employeeFundEffective: 1n,
  employerFundPrinted: null,
  tfrContributionLine: null,
  employeeFundEnrollment: null,
  employerFundEnrollment: null,
  employeeFundAdjustments: null,
  employerFundAdjustments: null,
});

describe("pensionCompetenceOf: the quarter of a payslip with no month", () => {
  it("gives the 14th and the 15th the quarter of the day they were printed", () => {
    expect(pensionCompetenceOf(row("fourteenth", "2026-07-10"), [])?.quarter).toBe(3);
    expect(pensionCompetenceOf(row("fifteenth", "2026-05-20"), [])?.quarter).toBe(2);
  });

  it("puts a 15th with no usable print day in the fourth quarter, a 14th nowhere", () => {
    expect(pensionCompetenceOf(row("fifteenth", null), [])?.quarter).toBe(4);
    expect(pensionCompetenceOf(row("fifteenth", "2027-01-15"), [])?.quarter).toBe(4);
    expect(pensionCompetenceOf(row("fourteenth", null), [])).toBeNull();
  });
});
