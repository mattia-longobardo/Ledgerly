import { describe, expect, it } from "vitest";
import {
  accrueDay,
  DEFAULT_RUN_HOUR,
  FRESH_READING_MS,
  isFreshReading,
  formatRunHour,
  hourIn,
  runsAt,
  fixedFromDecimal,
  fixedToDecimal,
  grossOfDay,
  periodOf,
  reconcile,
  settlementPeriods,
  validateTiers,
  assignPayments,
  percentToFraction,
  fractionToPercent,
} from "./rules";

const S = 1_000_000_000_000n; // one cent in fixed point

describe("fixed point", () => {
  it("reads and writes twelve decimals exactly", () => {
    expect(fixedFromDecimal("0.0275")).toBe(27_500_000_000n);
    expect(fixedFromDecimal("-1.5")).toBe(-1_500_000_000_000n);
    expect(fixedToDecimal(1_234_567_890_123n)).toBe("1.234567890123");
    expect(fixedToDecimal(-5n)).toBe("-0.000000000005");
    expect(() => fixedFromDecimal("1e3")).toThrow();
  });
});

describe("grossOfDay (spec §7.6)", () => {
  const flat = [{ upToCents: null, annualRate: "0.0365" }];
  it("is balance × rate / basis, in cents with twelve decimals", () => {
    // 10.000,00 € at 3,65 % on 365 days: exactly 1,00 € a day.
    expect(grossOfDay(1_000_000n, flat, 365)).toBe(100n * S);
    // On 360 days the same day is worth more.
    expect(grossOfDay(1_000_000n, flat, 360)).toBe((1_000_000n * 36_500_000_000n) / 360n);
  });

  it("applies the first rate up to the threshold and the next on the excess", () => {
    const tiers = [
      { upToCents: 2_000_000n, annualRate: "0.0365" },
      { upToCents: null, annualRate: "0.0073" },
    ];
    // 20.000 € at 3,65 % = 2,00 €; 10.000 € at 0,73 % = 0,20 €.
    expect(grossOfDay(3_000_000n, tiers, 365)).toBe(220n * S);
    // Below the threshold only the first rate counts.
    expect(grossOfDay(1_000_000n, tiers, 365)).toBe(100n * S);
    // Exactly on it, nothing spills over.
    expect(grossOfDay(2_000_000n, tiers, 365)).toBe(200n * S);
  });
});

describe("accrueDay (spec §7.6)", () => {
  const flat = [{ upToCents: null, annualRate: "0.0365" }];

  it("withholds the tax, rounds half-up and carries the rest", () => {
    // 1.000,00 € → 0,10 € gross, 26 % tax → 0,074 €: 7 cents today, 0,4 cents carried.
    const first = accrueDay({
      balanceCents: 100_000n,
      tiers: flat,
      basis: 365,
      taxRate: "0.26",
      carryBefore: 0n,
    });
    expect(first).toMatchObject({ status: "accrued", netCents: 7n, carryAfter: (4n * S) / 10n });
    // The next day 7,4 + 0,4 = 7,8 cents → 8 cents, −0,2 carried.
    const second = accrueDay({
      balanceCents: 100_000n,
      tiers: flat,
      basis: 365,
      taxRate: "0.26",
      carryBefore: first.carryAfter,
    });
    expect(second).toMatchObject({ netCents: 8n, carryAfter: (-2n * S) / 10n });
  });

  it("skips a negative or unknown balance visibly, with nothing carried", () => {
    expect(
      accrueDay({ balanceCents: -1n, tiers: flat, basis: 365, taxRate: "0.26", carryBefore: 5n }),
    ).toEqual({
      status: "negative_balance",
      grossFixed: 0n,
      netCents: 0n,
      carryAfter: 0n,
    });
    expect(
      accrueDay({ balanceCents: null, tiers: flat, basis: 365, taxRate: "0", carryBefore: 5n }).status,
    ).toBe("no_balance");
  });

  it("never pays a negative day", () => {
    const day = accrueDay({ balanceCents: 0n, tiers: flat, basis: 365, taxRate: "0", carryBefore: -3n * S });
    expect(day.netCents).toBe(0n);
    expect(day.carryAfter).toBe(-3n * S);
  });
});

describe("settlement periods", () => {
  it("cuts calendar months, quarters and years, clipped to the rule's validity", () => {
    expect(settlementPeriods("monthly", "2026-01-15", "2026-03-10")).toEqual([
      { from: "2026-01-15", to: "2026-01-31", settleOn: "2026-02-01" },
      { from: "2026-02-01", to: "2026-02-28", settleOn: "2026-03-01" },
      { from: "2026-03-01", to: "2026-03-10", settleOn: "2026-03-11" },
    ]);
    expect(settlementPeriods("quarterly", "2026-02-01", "2026-07-31").map((p) => [p.from, p.to])).toEqual([
      ["2026-02-01", "2026-03-31"],
      ["2026-04-01", "2026-06-30"],
      ["2026-07-01", "2026-07-31"],
    ]);
    expect(settlementPeriods("annual", "2025-06-01", "2026-12-31").map((p) => p.settleOn)).toEqual([
      "2026-01-01",
      "2027-01-01",
    ]);
  });

  it("settles a daily payout every day", () => {
    expect(settlementPeriods("daily", "2026-01-30", "2026-02-01")).toEqual([
      { from: "2026-01-30", to: "2026-01-30", settleOn: "2026-01-31" },
      { from: "2026-01-31", to: "2026-01-31", settleOn: "2026-02-01" },
      { from: "2026-02-01", to: "2026-02-01", settleOn: "2026-02-02" },
    ]);
    expect(periodOf("daily", "2026-09-19")).toEqual({ from: "2026-09-19", to: "2026-09-19" });
  });

  it("names the period a day falls in", () => {
    expect(periodOf("quarterly", "2026-09-19")).toEqual({ from: "2026-07-01", to: "2026-09-30" });
  });
});

describe("reconcile (spec §7.6)", () => {
  const base = { accruedDays: 30, accruedCents: 1_000n, posting: "none" as const, windowOpen: false };
  it("has no data without accruals or without a way to see the payment", () => {
    expect(reconcile({ ...base, accruedDays: 0, paidCents: 1_000n })).toBe("no_data");
    expect(reconcile({ ...base, paidCents: null })).toBe("no_data");
  });
  it("is indeterminate while a posting is unsure", () => {
    expect(reconcile({ ...base, posting: "indeterminate", paidCents: 1_000n })).toBe("indeterminate");
    expect(reconcile({ ...base, posting: "claimed", paidCents: 0n })).toBe("indeterminate");
  });
  it("matches within one cent, and tells missing, delayed and anomalous apart", () => {
    expect(reconcile({ ...base, paidCents: 999n })).toBe("matched");
    expect(reconcile({ ...base, paidCents: 998n })).toBe("anomalous");
    expect(reconcile({ ...base, paidCents: 0n })).toBe("missing");
    expect(reconcile({ ...base, paidCents: 0n, windowOpen: true })).toBe("delayed");
    expect(reconcile({ ...base, paidCents: 500n, windowOpen: true })).toBe("delayed");
    expect(reconcile({ ...base, paidCents: 1_200n, windowOpen: true })).toBe("anomalous");
  });
});

describe("validateTiers", () => {
  it("wants increasing thresholds, one open last tier and rates between 0 and 1", () => {
    expect(
      validateTiers([
        { upToCents: 100n, annualRate: "0.02" },
        { upToCents: null, annualRate: "0.01" },
      ]),
    ).toBe(true);
    expect(validateTiers([{ upToCents: null, annualRate: "0.02" }])).toBe(true);
    expect(validateTiers([{ upToCents: 100n, annualRate: "0.02" }])).toBe(false);
    expect(
      validateTiers([
        { upToCents: 200n, annualRate: "0.02" },
        { upToCents: 100n, annualRate: "0.01" },
        { upToCents: null, annualRate: "0" },
      ]),
    ).toBe(false);
    expect(validateTiers([{ upToCents: null, annualRate: "1.5" }])).toBe(false);
    expect(validateTiers([])).toBe(false);
  });
});

describe("percentages", () => {
  it("turns a typed percentage into the stored fraction and back, exactly", () => {
    expect(percentToFraction("2.75")).toBe("0.027500");
    expect(percentToFraction("26")).toBe("0.260000");
    expect(percentToFraction("0.0125")).toBe("0.000125");
    expect(percentToFraction("100")).toBe("1.000000");
    expect(() => percentToFraction("2,75")).toThrow();
    expect(fractionToPercent("0.027500")).toBe("2.75");
    expect(fractionToPercent("0.260000")).toBe("26");
    expect(fractionToPercent("0.000125")).toBe("0.0125");
  });
});

describe("assignPayments", () => {
  it("gives a daily payout one payment, each counted once, in date order", () => {
    const days = ["2026-03-01", "2026-03-02", "2026-03-03"].map((on) => ({ id: on, to: on, settleOn: on }));
    // The bank pays each day's interest the day after; nothing came for the 3rd yet.
    const payments = [
      { id: "p-2", on: "2026-03-03" },
      { id: "p-1", on: "2026-03-02" },
    ];
    expect([...assignPayments("daily", days, payments)]).toEqual([
      ["2026-03-01", ["p-1"]],
      ["2026-03-02", ["p-2"]],
      ["2026-03-03", []],
    ]);
  });

  it("gives a period payout every payment of its window no earlier one took", () => {
    const months = [
      { id: "jan", to: "2026-01-31", settleOn: "2026-02-01" },
      { id: "feb", to: "2026-02-28", settleOn: "2026-03-01" },
    ];
    const payments = [
      { id: "a", on: "2026-02-03" },
      { id: "b", on: "2026-02-10" },
      { id: "c", on: "2026-03-02" },
    ];
    expect(assignPayments("monthly", months, payments)).toEqual(
      new Map([
        ["jan", ["a", "b"]],
        ["feb", ["c"]],
      ]),
    );
  });
});

describe("the hour a rule runs at (spec §10.2, the hourly pass)", () => {
  // The instants below are UTC; what each assertion states is the wall clock of the zone named.
  const winter = new Date("2026-01-15T11:00:00Z"); // 12:00 in Rome (UTC+1)
  const summer = new Date("2026-07-15T10:00:00Z"); // 12:00 in Rome (UTC+2)

  it("reads the hour on the user's clock, in standard time and in summer time", () => {
    expect(hourIn(winter, "Europe/Rome")).toBe(12);
    expect(hourIn(summer, "Europe/Rome")).toBe(12);
    // The day the zone springs forward (29 March 2026, 02:00 → 03:00) is noon all the same.
    expect(hourIn(new Date("2026-03-29T10:00:00Z"), "Europe/Rome")).toBe(12);
    // And the day it falls back (25 October 2026), where 02:00 happens twice.
    expect(hourIn(new Date("2026-10-25T00:00:00Z"), "Europe/Rome")).toBe(2); // the first 02:00, CEST
    expect(hourIn(new Date("2026-10-25T01:00:00Z"), "Europe/Rome")).toBe(2); // the second, CET
  });

  it("never reads the server's clock: another zone is another hour", () => {
    expect(hourIn(winter, "UTC")).toBe(11);
    expect(hourIn(winter, "America/New_York")).toBe(6);
    expect(hourIn(winter, "Pacific/Auckland")).toBe(24 % 24); // 00:00 the next day, not 24
    // A zone half an hour off the hour still belongs to the hour its clock shows.
    expect(hourIn(winter, "Asia/Kolkata")).toBe(16); // 16:30
    expect(hourIn(new Date("2026-01-15T18:45:00Z"), "Asia/Kathmandu")).toBe(0); // 00:30, next day
  });

  it("runs a rule with no hour of its own at noon, where the daily job ran", () => {
    expect(DEFAULT_RUN_HOUR).toBe(12);
    expect(runsAt(null, winter, "Europe/Rome")).toBe(true);
    expect(runsAt(null, summer, "Europe/Rome")).toBe(true);
    // Any other pass of the day leaves it alone: one pass a day is its pass.
    expect(runsAt(null, new Date("2026-01-15T10:00:00Z"), "Europe/Rome")).toBe(false);
    expect(runsAt(null, new Date("2026-01-15T12:00:00Z"), "Europe/Rome")).toBe(false);
    // Noon in Rome is not noon in New York: there the same instant is no one's hour but 6.
    expect(runsAt(null, winter, "America/New_York")).toBe(false);
    expect(runsAt(6, winter, "America/New_York")).toBe(true);
  });

  it("runs a rule with an hour set at that hour, midnight included", () => {
    expect(runsAt(9, new Date("2026-01-15T08:00:00Z"), "Europe/Rome")).toBe(true);
    expect(runsAt(9, new Date("2026-07-15T08:00:00Z"), "Europe/Rome")).toBe(false); // 10:00 CEST
    expect(runsAt(9, new Date("2026-07-15T07:00:00Z"), "Europe/Rome")).toBe(true);
    expect(runsAt(0, new Date("2026-01-14T23:00:00Z"), "Europe/Rome")).toBe(true); // 00:00, not 24
    expect(runsAt(23, new Date("2026-01-15T22:00:00Z"), "Europe/Rome")).toBe(true);
  });

  it("writes an hour the way the dialog shows it", () => {
    expect([formatRunHour(0), formatRunHour(9), formatRunHour(23)]).toEqual(["00:00", "09:00", "23:00"]);
  });
});

describe("a balance fresh enough to accrue on (spec §7.6)", () => {
  const now = new Date("2026-01-15T12:00:00Z");

  it("takes a reading of this hour and refuses one older than the sync interval", () => {
    expect(FRESH_READING_MS).toBe(60 * 60 * 1000);
    expect(isFreshReading(now, now)).toBe(true);
    expect(isFreshReading(new Date("2026-01-15T11:30:00Z"), now)).toBe(true);
    // Exactly the interval is still in; one second past it is a pass that never landed.
    expect(isFreshReading(new Date("2026-01-15T11:00:00Z"), now)).toBe(true);
    expect(isFreshReading(new Date("2026-01-15T10:59:59Z"), now)).toBe(false);
    expect(isFreshReading(new Date("2026-01-14T12:00:00Z"), now)).toBe(false);
  });

  it("never calls an account that was never read fresh", () => {
    expect(isFreshReading(null, now)).toBe(false);
    expect(isFreshReading(null, now, 10 * 60 * 60 * 1000)).toBe(false);
  });

  it("accepts a reading stamped by a pass that started after this one", () => {
    expect(isFreshReading(new Date("2026-01-15T12:00:30Z"), now)).toBe(true);
  });
});
