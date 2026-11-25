import { describe, expect, it } from "vitest";
import { type AppliedPayslip, competenceOf } from "./payroll-source";

/** The kind and extra payment's number an old type stands for, as payroll sends them. */
const KINDS: Record<string, { kind: string; extraNumber: number | null }> = {
  ordinary: { kind: "ordinary", extraNumber: null },
  thirteenth: { kind: "extra", extraNumber: 1 },
  fourteenth: { kind: "extra", extraNumber: 2 },
  fifteenth: { kind: "extra", extraNumber: 3 },
};

const row = (type: string, printedOn: string | null): AppliedPayslip => ({
  payslipId: "p",
  period: null,
  ...KINDS[type],
  year: 2026,
  printedOn,
  workerCents: 1n,
  employerCents: null,
  tfrCents: null,
  workerEnrollmentCents: null,
  employerEnrollmentCents: null,
  workerAdjustmentCents: null,
  employerAdjustmentCents: null,
  lines: [],
});

describe("competenceOf: the quarter of a payslip with no month", () => {
  it("gives the 14th and the 15th the quarter of the day they were printed", () => {
    expect(competenceOf(row("fourteenth", "2026-07-10"))?.quarter).toBe(3);
    expect(competenceOf(row("fifteenth", "2026-05-20"))?.quarter).toBe(2);
  });

  it("puts a 15th with no usable print day in the fourth quarter, a 14th nowhere", () => {
    expect(competenceOf(row("fifteenth", null))?.quarter).toBe(4);
    expect(competenceOf(row("fifteenth", "2027-01-15"))?.quarter).toBe(4);
    expect(competenceOf(row("fourteenth", null))).toBeNull();
    expect(competenceOf(row("thirteenth", null))?.quarter).toBe(4);
  });
});

describe("competenceOf: the lines that carry pension money", () => {
  it("keeps the lines of the fund's roles only, in their order", () => {
    const payslip = {
      ...row("ordinary", null),
      period: "2026-05-01",
      lines: [
        { id: "a", role: "ordinary_earnings" },
        { id: "b", role: "employee_fund" },
        { id: "c", role: "tfr_contribution" },
        { id: "d", role: "other" },
      ],
    };
    expect(competenceOf(payslip)).toMatchObject({ quarter: 2, sourceLineIds: ["b", "c"] });
  });
});
