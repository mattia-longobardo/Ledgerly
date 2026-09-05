import { describe, expect, it } from "vitest";
import type { PayrollComponent, PayrollRecord } from "../application/ports";
import { summariseEarnings } from "./earnings";

function record(over: Partial<PayrollRecord> & { id: string; periodStart: string }): PayrollRecord {
  return {
    userId: "u1",
    importId: `imp-${over.id}`,
    periodEnd: `${over.periodStart.slice(0, 7)}-28`,
    payDate: null,
    kind: "ordinary",
    currency: "EUR",
    gross: "2500.00",
    net: "1800.00",
    verifiedAt: null,
    verifiedBy: null,
    corrections: null,
    supersededAt: null,
    supersededByRecordId: null,
    version: 1,
    createdAt: new Date("2026-09-05T00:00:00Z"),
    updatedAt: new Date("2026-09-05T00:00:00Z"),
    ...over,
  };
}

function component(recordId: string, code: string, kind: PayrollComponent["kind"], amount: string | null): PayrollComponent {
  return {
    id: `${recordId}-${code}`,
    recordId,
    code,
    labelRaw: code,
    kind,
    amount,
    quantity: null,
    unit: "eur",
    currency: "EUR",
    confidence: "high",
    source: "rules",
    mappedTo: { kind: "earnings" },
    sortOrder: 0,
    createdAt: new Date("2026-09-05T00:00:00Z"),
  };
}

describe("summariseEarnings", () => {
  const records = [
    record({ id: "r1", periodStart: "2026-01-01" }),
    record({ id: "r2", periodStart: "2026-02-01" }),
    record({ id: "r3", periodStart: "2026-04-01" }),
  ];
  const components = [
    component("r1", "taxes", "tax", "700.00"),
    component("r1", "fundContribEmployee", "employee_contribution", "50.00"),
    component("r2", "taxes", "tax", "700.00"),
    component("r3", "taxes", "tax", "710.00"),
  ];

  it("buckets by month, newest first", () => {
    const summary = summariseEarnings(records, components);
    expect(summary.months.map((m) => m.key)).toEqual(["2026-04", "2026-02", "2026-01"]);
    expect(summary.months[0]).toMatchObject({ gross: "2500.00", net: "1800.00", taxes: "710.00", recordCount: 1 });
  });

  it("buckets by calendar quarter and by year, summing exactly", () => {
    const summary = summariseEarnings(records, components);
    expect(summary.quarters.map((q) => q.key)).toEqual(["2026-Q2", "2026-Q1"]);
    expect(summary.quarters.find((q) => q.key === "2026-Q1")).toMatchObject({
      gross: "5000.00", net: "3600.00", taxes: "1400.00", recordCount: 2,
    });
    expect(summary.years).toEqual([
      { key: "2026", gross: "7500.00", net: "5400.00", taxes: "2110.00", contributions: "50.00", recordCount: 3 },
    ]);
  });

  it("sums contributions from both employee and employer components", () => {
    const summary = summariseEarnings(
      [record({ id: "r1", periodStart: "2026-01-01" })],
      [
        component("r1", "fundContribEmployee", "employee_contribution", "50.00"),
        component("r1", "fundContribEmployer", "employer_contribution", "100.00"),
      ],
    );
    expect(summary.months[0]!.contributions).toBe("150.00");
  });

  it("reports null, never zero, for a figure no record carried", () => {
    const summary = summariseEarnings([record({ id: "r1", periodStart: "2026-01-01", gross: null })], []);
    expect(summary.months[0]!.gross).toBeNull();
    expect(summary.months[0]!.taxes).toBeNull();
    expect(summary.months[0]!.contributions).toBeNull();
    expect(summary.months[0]!.net).toBe("1800.00");
  });

  it("returns three empty lists for no records at all", () => {
    expect(summariseEarnings([], [])).toEqual({ months: [], quarters: [], years: [] });
  });

  it("ignores a component whose record is not in the list", () => {
    const summary = summariseEarnings(
      [record({ id: "r1", periodStart: "2026-01-01" })],
      [component("r-other", "taxes", "tax", "999.00")],
    );
    expect(summary.months[0]!.taxes).toBeNull();
  });
});
