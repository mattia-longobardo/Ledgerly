import { describe, expect, it } from "vitest";
import { absoluteReturn, depositedThrough, quarterlyRows, type ContributionLike } from "./totals";

function contribution(overrides: Partial<ContributionLike> = {}): ContributionLike {
  return {
    id: "row-1",
    typeCode: "employee",
    amount: "100.00",
    postedMonth: "2026-04-01",
    accrualPeriodStart: "2026-01-01",
    accrualPeriodEnd: "2026-03-01",
    source: "payroll",
    payrollRecordId: "payroll-1",
    ...overrides,
  };
}

describe("fund totals", () => {
  it("sums only posted signed rows and returns zero when none are posted", () => {
    const rows = [
      contribution({ id: "employee", amount: "100.00", postedMonth: "2026-03-01" }),
      contribution({ id: "fee", typeCode: "fee", amount: "-3.00", postedMonth: "2026-03-01" }),
      contribution({ id: "future", amount: "50.00", postedMonth: "2026-04-01" }),
    ];

    expect(depositedThrough(rows, "2026-03-01")).toBe("97.00");
    expect(depositedThrough(rows, "2026-02-01")).toBe("0.00");
  });

  it("adds decimal amounts exactly", () => {
    expect(depositedThrough([
      contribution({ id: "a", amount: "0.10", postedMonth: "2026-01-01" }),
      contribution({ id: "b", amount: "0.20", postedMonth: "2026-01-01" }),
    ], "2026-01-01")).toBe("0.30");
  });

  it("computes the absolute return and preserves a missing valuation", () => {
    expect(absoluteReturn("2228.13", "2184.06")).toBe("44.07");
    expect(absoluteReturn(null, "10.00")).toBeNull();
  });
});

describe("quarterlyRows", () => {
  const q1Rows = [
    contribution({ id: "jan-employee", amount: "150.00", payrollRecordId: "jan" }),
    contribution({ id: "feb-employee", amount: "250.00", payrollRecordId: "feb" }),
    contribution({ id: "mar-employer", typeCode: "employer", amount: "421.41", payrollRecordId: "mar" }),
    contribution({
      id: "q1-fee",
      typeCode: "fee",
      amount: "-3.00",
      source: "system",
      payrollRecordId: null,
    }),
  ];

  it("groups a posting period into gross, fees, and net", () => {
    expect(quarterlyRows(q1Rows, "2026-04-01")).toEqual([{
      quarter: "2026-Q1",
      accrualMonths: ["2026-01-01", "2026-02-01", "2026-03-01"],
      postedMonth: "2026-04-01",
      gross: "821.41",
      fees: "-3.00",
      net: "818.41",
      posted: true,
    }]);
    expect(quarterlyRows(q1Rows, "2026-03-01")[0]?.posted).toBe(false);
  });

  it("sorts posting periods ascending", () => {
    const q2 = contribution({
      id: "q2",
      postedMonth: "2026-07-01",
      accrualPeriodStart: "2026-04-01",
      accrualPeriodEnd: "2026-06-01",
    });
    expect(quarterlyRows([q2, ...q1Rows], "2026-12-01").map((row) => row.quarter)).toEqual([
      "2026-Q1",
      "2026-Q2",
    ]);
  });

  it("uses the full stored period span, including annual periods", () => {
    const annual = contribution({
      id: "annual",
      amount: "1200.00",
      postedMonth: "2027-01-01",
      accrualPeriodStart: "2026-01-01",
      accrualPeriodEnd: "2026-12-01",
    });
    expect(quarterlyRows([annual], "2026-12-01")[0]).toMatchObject({
      quarter: "2026-Q1",
      accrualMonths: [
        "2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01",
        "2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01",
        "2026-09-01", "2026-10-01", "2026-11-01", "2026-12-01",
      ],
      postedMonth: "2027-01-01",
      posted: false,
    });
  });

  it("keeps different posting months separate even when their accrual span matches", () => {
    const delayed = contribution({ id: "delayed", amount: "50.00", postedMonth: "2026-05-01" });
    const result = quarterlyRows([q1Rows[0]!, delayed], "2026-12-01");

    expect(result).toHaveLength(2);
    expect(result.map((row) => [row.postedMonth, row.gross])).toEqual([
      ["2026-04-01", "150.00"],
      ["2026-05-01", "50.00"],
    ]);
  });
});
