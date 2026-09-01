import { describe, expect, it } from "vitest";
import {
  balanceSeries,
  effectiveRate,
  expectedAccruals,
  fundBalance,
  withdrawalPreview,
  type AccrualRateRow,
  type LedgerEntry,
} from "./vacation-fund";

const rates: AccrualRateRow[] = [
  { effectiveFrom: "2025-01-01", monthlyAmount: "100.00" },
  { effectiveFrom: "2025-06-01", monthlyAmount: "150.00" },
];

const ledger: LedgerEntry[] = [
  { entryType: "initial", month: "2025-01-01", amount: "500.00" },
  { entryType: "accrual", month: "2025-02-01", amount: "100.00" },
  { entryType: "accrual", month: "2025-03-01", amount: "100.00" },
  { entryType: "withdrawal", amount: "-250.00", occurredAt: "2025-03-18" },
  { entryType: "accrual", month: "2025-05-01", amount: "150.00" },
];

describe("fundBalance", () => {
  it("is the signed sum of the ledger", () => {
    expect(fundBalance(ledger)).toBe(600);
    expect(fundBalance([])).toBe(0);
  });

  it("does not drift over many small signed entries", () => {
    const entries: LedgerEntry[] = Array.from({ length: 300 }, (_, i) => ({
      amount: i % 2 === 0 ? "0.10" : "-0.03",
    }));
    expect(fundBalance(entries)).toBe(10.5);
  });
});

describe("effectiveRate", () => {
  it("returns the rate in force for the month", () => {
    expect(effectiveRate(rates, "2025-01-01")).toBe(100);
    expect(effectiveRate(rates, "2025-05-01")).toBe(100);
    expect(effectiveRate(rates, "2025-06-01")).toBe(150);
    expect(effectiveRate(rates, "2026-02-01")).toBe(150);
  });

  it("returns null before the first rate row", () => {
    expect(effectiveRate(rates, "2024-12-01")).toBeNull();
    expect(effectiveRate([], "2025-01-01")).toBeNull();
  });
});

describe("expectedAccruals", () => {
  it("applies a rate change only from its effective month onwards", () => {
    const rows = expectedAccruals(rates, "2025-04-01", "2025-07-01");
    expect(rows).toEqual([
      { month: "2025-04-01", amount: 100 },
      { month: "2025-05-01", amount: 100 },
      { month: "2025-06-01", amount: 150 },
      { month: "2025-07-01", amount: 150 },
    ]);
  });

  it("leaves already-generated months untouched when a later rate is added", () => {
    const before = expectedAccruals(rates, "2025-01-01", "2025-05-01");
    const after = expectedAccruals(
      [...rates, { effectiveFrom: "2025-09-01", monthlyAmount: "200.00" }],
      "2025-01-01",
      "2025-05-01",
    );
    expect(after).toEqual(before);
    expect(before.every((r) => r.amount === 100)).toBe(true);
  });

  it("omits months that predate every rate row", () => {
    expect(expectedAccruals(rates, "2024-11-01", "2025-01-01")).toEqual([
      { month: "2025-01-01", amount: 100 },
    ]);
    expect(expectedAccruals(rates, "2025-03-01", "2025-01-01")).toEqual([]);
  });
});

describe("balanceSeries", () => {
  const points = balanceSeries(ledger);

  it("runs on a continuous month axis", () => {
    expect(points.map((p) => p.month)).toEqual([
      "2025-01-01",
      "2025-02-01",
      "2025-03-01",
      "2025-04-01",
      "2025-05-01",
    ]);
  });

  it("accumulates signed entries and places withdrawals by occurrence month", () => {
    expect(points.map((p) => p.value)).toEqual([500, 600, 450, 450, 600]);
  });

  it("is empty for an empty ledger", () => {
    expect(balanceSeries([])).toEqual([]);
  });
});

describe("withdrawalPreview", () => {
  it("returns the balance after the withdrawal, sign-insensitively", () => {
    expect(withdrawalPreview(ledger, "250.00")).toBe(350);
    expect(withdrawalPreview(ledger, "-250.00")).toBe(350);
  });

  it("can go negative so the confirm step can warn", () => {
    expect(withdrawalPreview(ledger, "1000.00")).toBe(-400);
  });
});
