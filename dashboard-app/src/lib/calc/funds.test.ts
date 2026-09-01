import { describe, expect, it } from "vitest";
import {
  absoluteReturn,
  currentValue,
  effectiveSetting,
  monthlyReturn,
  returnTable,
  totalDeposited,
  type FundDepositRow,
  type FundSettingRow,
} from "./funds";

const settings: FundSettingRow[] = [
  {
    effectiveFrom: "2025-01-01",
    initialCapital: "1000.00",
    depositMode: "fixed",
    fixedMonthlyAmount: "100.00",
  },
  // Mode switch: this row carries its own initial_capital, which must be ignored.
  { effectiveFrom: "2025-04-01", initialCapital: "5000.00", depositMode: "payroll" },
];

const deposits: FundDepositRow[] = [
  { month: "2025-01-01", amount: "100.00" },
  { month: "2025-02-01", amount: "100.00" },
  { month: "2025-03-01", amount: "100.00" },
  { month: "2025-04-01", amount: "120.00" },
  { month: "2025-05-01", amount: "120.00" },
];

describe("totalDeposited", () => {
  it("is initial capital of the earliest settings row plus deposits up to M", () => {
    expect(totalDeposited(settings, deposits, "2025-01-01")).toBe(1100);
    expect(totalDeposited(settings, deposits, "2025-03-01")).toBe(1300);
    expect(totalDeposited(settings, deposits, "2025-05-01")).toBe(1540);
  });

  it("stays continuous across a fixed -> payroll mode switch", () => {
    const before = totalDeposited(settings, deposits, "2025-03-01");
    const after = totalDeposited(settings, deposits, "2025-04-01");
    expect(after - before).toBe(120);
    expect(after).toBe(1420);
  });

  it("ignores deposits after M and works with no settings at all", () => {
    expect(totalDeposited(settings, deposits, "2024-12-01")).toBe(1000);
    expect(totalDeposited([], deposits, "2025-02-01")).toBe(200);
    expect(totalDeposited([], [], "2025-02-01")).toBe(0);
  });
});

describe("effectiveSetting", () => {
  it("returns the latest row effective at or before the month", () => {
    expect(effectiveSetting(settings, "2025-03-01")?.depositMode).toBe("fixed");
    expect(effectiveSetting(settings, "2025-04-01")?.depositMode).toBe("payroll");
    expect(effectiveSetting(settings, "2026-09-01")?.depositMode).toBe("payroll");
    expect(effectiveSetting(settings, "2024-12-01")).toBeNull();
  });
});

describe("currentValue", () => {
  const series = [
    { month: "2025-01-01", value: 1000 },
    { month: "2025-02-01", value: null },
    { month: "2025-03-01", value: 1300 },
  ];

  it("takes the latest observed value at or before the month", () => {
    expect(currentValue(series, "2025-03-01")).toBe(1300);
    expect(currentValue(series, "2025-02-01")).toBe(1000);
    expect(currentValue(series, "2025-12-01")).toBe(1300);
    expect(currentValue(series, "2024-01-01")).toBeNull();
  });

  it("accepts a Series object as well as bare points", () => {
    expect(currentValue({ key: "fideuram", label: "Fideuram", points: series }, "2025-03-01")).toBe(
      1300,
    );
  });
});

describe("absoluteReturn", () => {
  it("is value minus total deposited", () => {
    expect(absoluteReturn("1420.00", 1300)).toBe(120);
    expect(absoluteReturn(1250, "1300.00")).toBe(-50);
    expect(absoluteReturn(null, 1300)).toBeNull();
  });
});

describe("monthlyReturn (simple Dietz)", () => {
  it("reproduces the hand-calculated figures", () => {
    // 10 800 − 10 000 − 500 = 300 ; 300 / (10 000 + 500) = 2.857142…%
    const r = monthlyReturn({ valueM: "10800.00", valuePrev: "10000.00", depositsInM: "500.00" });
    expect(r.abs).toBe(300);
    expect(r.pct).toBeCloseTo(2.857142857142857, 12);
  });

  it("handles a plain loss with no deposits", () => {
    const r = monthlyReturn({ valueM: 900, valuePrev: 1000 });
    expect(r.abs).toBe(-100);
    expect(r.pct).toBe(-10);
  });

  it("returns null pct instead of Infinity when the denominator is zero", () => {
    const r = monthlyReturn({ valueM: "100.00", valuePrev: "0.00", depositsInM: "0.00" });
    expect(r.abs).toBe(100);
    expect(r.pct).toBeNull();
  });

  it("returns null pct when deposits exactly offset a zero opening value", () => {
    const r = monthlyReturn({ valueM: "100.00", valuePrev: "50.00", depositsInM: "-50.00" });
    expect(r.pct).toBeNull();
  });

  it("returns nulls, never NaN, when a value is missing", () => {
    expect(monthlyReturn({ valueM: null, valuePrev: 100 })).toEqual({ abs: null, pct: null });
    expect(monthlyReturn({ valueM: 100, valuePrev: null })).toEqual({ abs: null, pct: null });
  });
});

describe("returnTable", () => {
  const series = [
    { month: "2025-01-01", value: 1100 },
    { month: "2025-03-01", value: 1350 },
    { month: "2025-04-01", value: 1500 },
  ];

  const rows = returnTable(settings, deposits, series, { from: "2025-01-01", to: "2025-04-01" });

  it("emits one row per month in the range", () => {
    expect(rows.map((r) => r.month)).toEqual([
      "2025-01-01",
      "2025-02-01",
      "2025-03-01",
      "2025-04-01",
    ]);
  });

  it("carries deposits forward but leaves missing values null, not zero", () => {
    const feb = rows[1];
    expect(feb?.value).toBeNull();
    expect(feb?.absReturn).toBeNull();
    expect(feb?.monthAbs).toBeNull();
    expect(feb?.monthPct).toBeNull();
    expect(feb?.deposited).toBe(1200);
  });

  it("does not bridge a gap when computing the monthly return", () => {
    const mar = rows[2];
    expect(mar?.value).toBe(1350);
    expect(mar?.absReturn).toBe(50);
    expect(mar?.monthAbs).toBeNull();
  });

  it("computes the monthly return where consecutive months exist", () => {
    const apr = rows[3];
    expect(apr?.monthAbs).toBe(30);
    expect(apr?.monthPct).toBeCloseTo((30 / 1470) * 100, 12);
    expect(apr?.absReturn).toBe(80);
  });
});
