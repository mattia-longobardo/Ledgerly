import { describe, expect, it } from "vitest";
import {
  cometaCreditedDeposits,
  cometaSchedule,
  creditMonthFor,
  creditedByMonth,
} from "./cometa";

/** The owner's real monthly Cometa contributions, read off the payslips. */
const ACCRUALS = [
  { month: "2025-10-01", amount: 0 },
  { month: "2025-11-01", amount: 201.19 },
  { month: "2025-12-01", amount: 342.25 },
  { month: "2026-01-01", amount: 273.8 },
  { month: "2026-02-01", amount: 273.81 },
  { month: "2026-03-01", amount: 273.8 },
  { month: "2026-04-01", amount: 273.8 },
  { month: "2026-05-01", amount: 273.8 },
  { month: "2026-06-01", amount: 280.61 },
];

describe("Cometa quarterly credits", () => {
  it("credits a quarter in the month after it closes", () => {
    expect(creditMonthFor("2025-11-01")).toBe("2026-01-01"); // Q4 2025 -> Jan
    expect(creditMonthFor("2026-02-01")).toBe("2026-04-01"); // Q1 2026 -> Apr
    expect(creditMonthFor("2026-06-01")).toBe("2026-07-01"); // Q2 2026 -> Jul
    expect(creditMonthFor("2026-09-01")).toBe("2026-10-01"); // Q3 2026 -> Oct
  });

  /**
   * Reconciles to the cent against `DettaglioOperazioni`: the three credits are
   * 540,44 / 818,41 / 825,21 net of a €3 quarterly fee.
   */
  it("reproduces the real transaction export", () => {
    const credits = cometaSchedule(ACCRUALS);
    expect(credits).toHaveLength(3);

    expect(credits[0]).toMatchObject({
      quarter: "2025-Q4",
      creditedMonth: "2026-01-01",
      grossContributed: 543.44,
      fees: 13.32, // €3 quarterly + €10,32 joining, charged once
      netInvested: 530.12,
    });
    expect(credits[1]).toMatchObject({
      quarter: "2026-Q1",
      creditedMonth: "2026-04-01",
      grossContributed: 821.41,
      fees: 3,
      netInvested: 818.41,
    });
    expect(credits[2]).toMatchObject({
      quarter: "2026-Q2",
      creditedMonth: "2026-07-01",
      grossContributed: 828.21,
      fees: 3,
      netInvested: 825.21,
    });
  });

  it("charges the joining fee only once", () => {
    const fees = cometaSchedule(ACCRUALS).map((c) => c.fees);
    expect(fees).toEqual([13.32, 3, 3]);
  });

  it("groups the accrual months under their quarter", () => {
    const credits = cometaSchedule(ACCRUALS);
    expect(credits[0]!.accrualMonths).toEqual(["2025-10-01", "2025-11-01", "2025-12-01"]);
    expect(credits[2]!.accrualMonths).toEqual(["2026-04-01", "2026-05-01", "2026-06-01"]);
  });

  it("leaves an incomplete quarter as its own credit", () => {
    // July alone: Q3 is still open, but the model must not lose the money.
    const credits = cometaSchedule([{ month: "2026-07-01", amount: 280.6 }], { joiningFee: 0 });
    expect(credits).toHaveLength(1);
    expect(credits[0]!.creditedMonth).toBe("2026-10-01");
    expect(credits[0]!.visibleMonth).toBe("2026-11-01");
    expect(credits[0]!.netInvested).toBe(277.6);
  });

  it("keys net amounts by the month the money becomes visible", () => {
    // Paid 20/01, 13/04, 16/07; a recorded value describes the month before it,
    // so each credit surfaces one month after the payment.
    const byMonth = creditedByMonth(cometaSchedule(ACCRUALS));
    expect([...byMonth.keys()]).toEqual(["2026-02-01", "2026-05-01", "2026-08-01"]);
    // Nothing lands in the accrual months themselves.
    expect(byMonth.get("2026-03-01")).toBeUndefined();
  });

  it("ignores months with no contribution figure", () => {
    const credits = cometaSchedule([
      { month: "2026-01-01", amount: null },
      { month: "2026-02-01", amount: 100 },
    ], { joiningFee: 0 });
    expect(credits[0]!.grossContributed).toBe(100);
  });
});

describe("Cometa credited deposits drive the fund return", () => {
  /** The live payslips: Q3 (Jul + Aug) is accrued but its credit is not yet visible. */
  const LIVE_ACCRUALS = [
    ...ACCRUALS,
    { month: "2026-07-01", amount: 280.6 },
    { month: "2026-08-01", amount: 280.6 },
  ];
  /** The recorded value the fund page compares against. */
  const VALUE = 2228.13;
  /** The month the fund page renders for. */
  const AS_OF = "2026-09-01";

  function creditedDepositedAt(asOf: string): number {
    return Number(
      cometaCreditedDeposits(LIVE_ACCRUALS)
        .filter((r) => r.month <= asOf)
        .reduce((s, r) => s + r.amount, 0)
        .toFixed(2),
    );
  }

  it("counts only credited quarters, matching the export to the cent", () => {
    // Q4 530,12 + Q1 818,41 + Q2 825,21 — net of the €3 quarterly fee (and the
    // €10,32 joining fee on Q4), exactly the three credits in DettaglioOperazioni.
    expect(creditedDepositedAt(AS_OF)).toBe(2173.74);
  });

  it("keeps a quarter accrued-but-not-yet-credited out of the denominator", () => {
    const rows = cometaCreditedDeposits(LIVE_ACCRUALS);
    // The Q3 credit only becomes visible in November, so it is absent at September.
    const q3 = rows.find((r) => r.month === "2026-11-01");
    expect(q3?.amount).toBe(558.2);
    expect(rows.some((r) => r.month <= AS_OF && r.month === "2026-11-01")).toBe(false);
  });

  it("yields a non-negative return once uncredited accruals are excluded", () => {
    // The bug: summing every monthly accrual (2.754,26) exceeds the value and
    // shows a phantom loss.
    const rawSum = Number(LIVE_ACCRUALS.reduce((s, a) => s + a.amount, 0).toFixed(2));
    expect(rawSum).toBe(2754.26);
    expect(VALUE - rawSum).toBeLessThan(0);

    // The fix: measured against credited deposits only, the return is positive.
    expect(VALUE - creditedDepositedAt(AS_OF)).toBeCloseTo(54.39, 2);
    expect(VALUE - creditedDepositedAt(AS_OF)).toBeGreaterThan(0);
  });
});
