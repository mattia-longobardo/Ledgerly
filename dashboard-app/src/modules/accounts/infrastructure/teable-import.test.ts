import { describe, expect, it } from "vitest";
import { pivotExportedRecords, planTeableImport, type TeableImportInput } from "./teable-import";

const OWNER = "00000000-0000-7000-8000-000000000001";

function input(overrides: Partial<TeableImportInput> = {}): TeableImportInput {
  return { userId: OWNER, tracked: [], funds: [], points: [], walletSnapshots: [], ...overrides };
}

describe("pivotExportedRecords", () => {
  it("turns exported rows into (key, month, value) points, skipping cells the row lacks", () => {
    const points = pivotExportedRecords([
      { id: "rec_aug", fields: { Date: "2026-08-01", ING: 1234.56, Fideuram: "5.100,00", TOTAL: 6334.56 } },
      { id: "rec_no_date", fields: { ING: 1 } },
    ]);

    expect(points).toEqual([
      { key: "fideuram", column: "Fideuram", month: "2026-08-01", value: 5100 },
      { key: "ing", column: "ING", month: "2026-08-01", value: 1234.56 },
      { key: "total", column: "TOTAL", month: "2026-08-01", value: 6334.56 },
    ]);
  });

  it("keeps an empty cell a gap rather than a zero", () => {
    const points = pivotExportedRecords([
      { id: "rec", fields: { Date: "2026-08-01", "Fondo Cometa": null } },
    ]);

    expect(points).toEqual([{ key: "cometa", column: "Fondo Cometa", month: "2026-08-01", value: null }]);
  });
});

describe("planTeableImport", () => {
  it("dates a Teable cell to the end of its month and collapses same-day wallet rows", () => {
    const plan = planTeableImport(
      input({
        points: [
          { key: "etoro", month: "2026-01-01", value: 100 },
          { key: "total", month: "2026-01-01", value: 999 },
          { key: "cometa", month: "2026-02-01", value: null },
        ],
        walletSnapshots: [
          // Both 2026-09-01 in Europe/Rome (10:00 and 22:00 local).
          { accountKey: "ing", balance: "1500.00", capturedAt: new Date("2026-09-01T08:00:00Z") },
          { accountKey: "ing", balance: "1620.50", capturedAt: new Date("2026-09-01T20:00:00Z") },
        ],
      }),
    );

    expect(plan.accounts).toEqual([
      { key: "ing", name: "ING - Salary", type: "checking", origin: "manual", includeInNetWorth: true, sortOrder: 0 },
      { key: "etoro", name: "EToro", type: "investment", origin: "manual", includeInNetWorth: true, sortOrder: 0 },
      { key: "cometa", name: "Fondo Cometa", type: "pension_fund", origin: "manual", includeInNetWorth: true, sortOrder: 0 },
    ]);

    // January's cell lands on the 31st; the null February cell is a gap, so it
    // produces no balance at all; the two same-day wallet rows collapse to the
    // later one.
    expect(plan.balances).toEqual([
      { key: "etoro", asOf: "2026-01-31", balance: "100.00", source: "migration" },
      { key: "ing", asOf: "2026-09-01", balance: "1620.50", source: "provider" },
    ]);

    expect(plan.skipped).toEqual([{ key: "total", reason: "derived figure" }]);
  });

  it("names accounts from the registries and splits Revolut into its sub-accounts", () => {
    const plan = planTeableImport(
      input({
        tracked: [{ slug: "etoro", label: "eToro (personal)", sortOrder: 3, visible: false }],
        funds: [{ slug: "cometa", name: "Fondo Cometa" }],
        points: [
          { key: "etoro", month: "2026-01-01", value: 10 },
          { key: "revolut_total", month: "2026-01-01", value: 50 },
        ],
        walletSnapshots: [
          { accountKey: "revolut_main", balance: "30.00", capturedAt: new Date("2026-09-01T08:00:00Z") },
          { accountKey: "revolut_savings", balance: "20.00", capturedAt: new Date("2026-09-01T08:00:00Z") },
        ],
      }),
    );

    // A hidden hand-tracked account is still imported — hiding never removed it
    // from the total — and it carries the registry's own label and order. Fondo
    // Cometa comes from the funds registry although Teable sent no cell for it.
    expect(plan.accounts).toEqual([
      { key: "etoro", name: "eToro (personal)", type: "investment", origin: "manual", includeInNetWorth: true, sortOrder: 3 },
      { key: "cometa", name: "Fondo Cometa", type: "pension_fund", origin: "manual", includeInNetWorth: true, sortOrder: 0 },
      { key: "revolut_main", name: "Revolut", type: "checking", origin: "manual", includeInNetWorth: true, sortOrder: 0 },
      { key: "revolut_savings", name: "Savings", type: "savings", origin: "manual", includeInNetWorth: true, sortOrder: 0 },
    ]);

    expect(plan.balances.map((b) => b.key)).toEqual(["etoro", "revolut_main", "revolut_savings"]);
    expect(plan.skipped).toEqual([{ key: "revolut_total", reason: "derived figure" }]);
  });

  it("keeps the last known value of a month and never lets a later empty cell erase it", () => {
    const plan = planTeableImport(
      input({
        points: [
          { key: "isybank", month: "2026-03-01", value: 10 },
          { key: "isybank", month: "2026-03-01", value: 12.5 },
          { key: "isybank", month: "2026-03-01", value: null },
        ],
      }),
    );

    expect(plan.balances).toEqual([
      { key: "isybank", asOf: "2026-03-31", balance: "12.50", source: "migration" },
    ]);
  });
});
