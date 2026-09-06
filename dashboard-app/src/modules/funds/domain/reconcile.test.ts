import { describe, expect, it } from "vitest";
import { detectIssues } from "./reconcile";
import type { ContributionLike } from "./totals";

function row(month: string, overrides: Partial<ContributionLike> = {}): ContributionLike {
  return {
    id: `row-${month}`,
    typeCode: "employee",
    amount: "250.00",
    postedMonth: month,
    accrualPeriodStart: month,
    accrualPeriodEnd: month,
    source: "payroll",
    payrollRecordId: `payroll-${month}`,
    ...overrides,
  };
}

describe("fund reconciliation", () => {
  it("detects a payroll month without contribution evidence", () => {
    expect(detectIssues({
      fundId: "fund-1",
      payrollMonths: ["2026-01-01", "2026-02-01"],
      rows: [row("2026-01-01")],
    })).toEqual([{
      kind: "missing",
      entityType: "fund_month",
      entityId: "fund-1:2026-02-01",
      severity: "warning",
      detail: { month: "2026-02-01" },
    }]);
  });

  it("uses the stored period span as evidence for every accrued month", () => {
    expect(detectIssues({
      fundId: "fund-1",
      payrollMonths: ["2026-01-01", "2026-02-01", "2026-03-01"],
      rows: [row("2026-01-01", { accrualPeriodEnd: "2026-03-01" })],
    })).toEqual([]);
  });

  it("uses an enriched payroll month instead of treating a quarterly span as three payroll records", () => {
    expect(detectIssues({
      fundId: "fund-1",
      payrollMonths: ["2026-01-01", "2026-02-01"],
      rows: [row("2026-01-01", {
        accrualPeriodEnd: "2026-03-01",
        payrollAccrualMonth: "2026-01-01",
      })],
    })).toEqual([expect.objectContaining({
      kind: "missing",
      entityId: "fund-1:2026-02-01",
    })]);
  });

  it("recognises payroll-linked migration rows as payroll provenance", () => {
    expect(detectIssues({
      fundId: "fund-1",
      payrollMonths: ["2026-01-01"],
      rows: [row("2026-01-01", { source: "migration" })],
    })).toEqual([]);
  });

  it("does not treat system fees or reversals as payroll evidence", () => {
    expect(detectIssues({
      fundId: "fund-1",
      payrollMonths: ["2026-01-01"],
      rows: [
        row("2026-01-01", { id: "fee", typeCode: "fee", amount: "-3.00", source: "system", payrollRecordId: null }),
        row("2026-01-01", { id: "reversal", typeCode: "reversal", amount: "-250.00" }),
      ],
    })).toEqual([expect.objectContaining({ kind: "missing", entityId: "fund-1:2026-01-01" })]);
  });

  it("detects the later duplicate for a type and payroll record", () => {
    expect(detectIssues({
      fundId: "fund-1",
      payrollMonths: [],
      rows: [
        row("2026-01-01", { id: "contribution-a", payrollRecordId: "payroll-1" }),
        row("2026-01-01", { id: "contribution-b", payrollRecordId: "payroll-1" }),
      ],
    })).toEqual([{
      kind: "duplicate",
      entityType: "fund_contribution",
      entityId: "contribution-b",
      severity: "error",
      detail: { duplicateOf: "contribution-a", payrollRecordId: "payroll-1", typeCode: "employee" },
    }]);
  });

  it("detects an amount outside the trailing median band", () => {
    const history = ["01", "02", "03", "04", "05", "06"].map((month) => row(`2026-${month}-01`));
    const result = detectIssues({
      fundId: "fund-1",
      payrollMonths: [],
      rows: [...history, row("2026-07-01", { id: "jump", amount: "900.00" })],
    });

    expect(result).toEqual([{
      kind: "anomalous",
      entityType: "fund_contribution",
      entityId: "jump",
      severity: "warning",
      detail: { amount: "900.00", median: "250.00", tolerance: 0.3 },
    }]);
  });

  it("accepts an amount inside the trailing median band", () => {
    const history = ["01", "02", "03", "04", "05", "06"].map((month) => row(`2026-${month}-01`));
    expect(detectIssues({
      fundId: "fund-1",
      payrollMonths: [],
      rows: [...history, row("2026-07-01", { amount: "260.00" })],
    })).toEqual([]);
  });

  it("orders anomaly history by the enriched payroll month", () => {
    const history = ["01", "02", "03", "04", "05", "06"].map((month, index) => row("2026-01-01", {
      id: `history-${6 - index}`,
      accrualPeriodEnd: "2026-12-01",
      payrollAccrualMonth: `2026-${month}-01`,
      payrollRecordId: `payroll-${month}`,
    }));
    const jump = row("2026-01-01", {
      id: "a-jump",
      amount: "900.00",
      accrualPeriodEnd: "2026-12-01",
      payrollAccrualMonth: "2026-07-01",
      payrollRecordId: "payroll-07",
    });

    expect(detectIssues({ fundId: "fund-1", payrollMonths: [], rows: [jump, ...history] }))
      .toEqual([expect.objectContaining({ kind: "anomalous", entityId: "a-jump" })]);
  });

  it("excludes fees and reversals from the anomaly history and candidates", () => {
    const history = ["01", "02", "03", "04", "05", "06"].map((month) => row(`2026-${month}-01`));
    expect(detectIssues({
      fundId: "fund-1",
      payrollMonths: [],
      rows: [
        ...history,
        row("2026-07-01", { id: "fee", typeCode: "fee", amount: "-900.00", source: "system", payrollRecordId: null }),
        row("2026-08-01", { id: "reversal", typeCode: "reversal", amount: "-900.00" }),
        row("2026-09-01", { id: "normal", amount: "260.00" }),
      ],
    })).toEqual([]);
  });

  it("returns no issues when there are no payroll months or rows", () => {
    expect(detectIssues({ fundId: "fund-1", payrollMonths: [], rows: [] })).toEqual([]);
  });
});
