import { describe, expect, it } from "vitest";
import { detectRecurring, type RecurringCandidate } from "./recurring";

const DAY_MS = 86_400_000;

function monthly(payee: string, amount: string, months: number[]): RecurringCandidate[] {
  return months.map((m) => ({ payee, amount, currency: "EUR", occurredAt: new Date(Date.UTC(2026, m, 1)) }));
}

/** Builds occurrences `offsets` days apart from a fixed base timestamp. */
function series(
  payee: string,
  amount: string,
  currency: string,
  base: number,
  offsets: readonly number[],
): RecurringCandidate[] {
  return offsets.map((offset) => ({ payee, amount, currency, occurredAt: new Date(base + offset * DAY_MS) }));
}

describe("detectRecurring", () => {
  it("detects a monthly payee with a stable amount across three or more occurrences", () => {
    const patterns = detectRecurring(monthly("Netflix", "-15.99", [4, 5, 6, 7]));
    expect(patterns).toHaveLength(1);
    expect(patterns[0]).toMatchObject({ payee: "Netflix", cadence: "monthly", occurrenceCount: 4 });
  });

  it("does not report a payee seen only twice", () => {
    expect(detectRecurring(monthly("One-off", "-5.00", [4, 5]))).toHaveLength(0);
  });

  it("does not report a payee whose amount varies by more than the band", () => {
    const candidates: RecurringCandidate[] = [
      { payee: "Variable", amount: "-10.00", currency: "EUR", occurredAt: new Date(Date.UTC(2026, 4, 1)) },
      { payee: "Variable", amount: "-30.00", currency: "EUR", occurredAt: new Date(Date.UTC(2026, 5, 1)) },
      { payee: "Variable", amount: "-10.00", currency: "EUR", occurredAt: new Date(Date.UTC(2026, 6, 1)) },
    ];
    expect(detectRecurring(candidates)).toHaveLength(0);
  });

  it("detects a pattern at the minimum of exactly three occurrences", () => {
    const patterns = detectRecurring(monthly("Gym", "-20.00", [4, 5, 6]));
    expect(patterns).toHaveLength(1);
    expect(patterns[0]).toMatchObject({ payee: "Gym", occurrenceCount: 3 });
  });

  it("includes an amount exactly at the 10% band edge", () => {
    // Median is 100.00; 90.00 sits exactly 10% below it — the inclusive edge.
    const candidates: RecurringCandidate[] = [
      { payee: "Edge", amount: "100.00", currency: "EUR", occurredAt: new Date(Date.UTC(2026, 4, 1)) },
      { payee: "Edge", amount: "100.00", currency: "EUR", occurredAt: new Date(Date.UTC(2026, 5, 1)) },
      { payee: "Edge", amount: "90.00", currency: "EUR", occurredAt: new Date(Date.UTC(2026, 6, 1)) },
    ];
    const patterns = detectRecurring(candidates);
    expect(patterns).toHaveLength(1);
    expect(patterns[0]).toMatchObject({ amountLow: "90.00", amountHigh: "100.00" });
  });

  it("excludes an amount one cent past the 10% band edge", () => {
    // 89.99 is 10.01% below the 100.00 median — just outside the band.
    const candidates: RecurringCandidate[] = [
      { payee: "PastEdge", amount: "100.00", currency: "EUR", occurredAt: new Date(Date.UTC(2026, 4, 1)) },
      { payee: "PastEdge", amount: "100.00", currency: "EUR", occurredAt: new Date(Date.UTC(2026, 5, 1)) },
      { payee: "PastEdge", amount: "89.99", currency: "EUR", occurredAt: new Date(Date.UTC(2026, 6, 1)) },
    ];
    expect(detectRecurring(candidates)).toHaveLength(0);
  });

  it("detects gaps at the inclusive edges of the monthly band (26 and 34 days)", () => {
    const base = Date.UTC(2026, 0, 1);
    const lower: RecurringCandidate[] = [0, 26, 52].map((offset) => ({
      payee: "LowerEdge",
      amount: "-20.00",
      currency: "EUR",
      occurredAt: new Date(base + offset * 86_400_000),
    }));
    const upper: RecurringCandidate[] = [0, 34, 68].map((offset) => ({
      payee: "UpperEdge",
      amount: "-20.00",
      currency: "EUR",
      occurredAt: new Date(base + offset * 86_400_000),
    }));
    expect(detectRecurring(lower)[0]).toMatchObject({ cadence: "monthly" });
    expect(detectRecurring(upper)[0]).toMatchObject({ cadence: "monthly" });
  });

  it("does not report a cadence for gaps one day outside every band", () => {
    // 25 days is past the 12-16 biweekly band and short of the 26-34
    // monthly band — it falls in the gap between them and matches nothing.
    const base = Date.UTC(2026, 0, 1);
    const candidates: RecurringCandidate[] = [0, 25, 50].map((offset) => ({
      payee: "NoBand",
      amount: "-20.00",
      currency: "EUR",
      occurredAt: new Date(base + offset * 86_400_000),
    }));
    expect(detectRecurring(candidates)).toHaveLength(0);
  });

  it("groups payees case-insensitively and reports the most recent occurrence's casing", () => {
    const candidates: RecurringCandidate[] = [
      { payee: "netflix", amount: "-15.99", currency: "EUR", occurredAt: new Date(Date.UTC(2026, 4, 1)) },
      { payee: "NETFLIX", amount: "-15.99", currency: "EUR", occurredAt: new Date(Date.UTC(2026, 5, 1)) },
      { payee: "Netflix", amount: "-15.99", currency: "EUR", occurredAt: new Date(Date.UTC(2026, 6, 1)) },
    ];
    const patterns = detectRecurring(candidates);
    expect(patterns).toHaveLength(1);
    expect(patterns[0]).toMatchObject({ payee: "Netflix", occurrenceCount: 3 });
  });

  it("returns an empty result for no transactions, never a fabricated pattern", () => {
    expect(detectRecurring([])).toHaveLength(0);
  });

  it("detects a monthly cadence and reports the exact lastSeenAt/nextExpectedAt", () => {
    const base = Date.UTC(2026, 0, 1);
    const patterns = detectRecurring(series("Monthly Payee", "-15.00", "EUR", base, [0, 30, 60]));
    expect(patterns).toHaveLength(1);
    expect(patterns[0]).toMatchObject({
      cadence: "monthly",
      occurrenceCount: 3,
      lastSeenAt: new Date(base + 60 * DAY_MS),
      nextExpectedAt: new Date(base + 90 * DAY_MS),
    });
  });

  it("detects a weekly cadence and reports the exact lastSeenAt/nextExpectedAt", () => {
    const base = Date.UTC(2026, 0, 1);
    const patterns = detectRecurring(series("Weekly Payee", "-9.99", "EUR", base, [0, 7, 14]));
    expect(patterns).toHaveLength(1);
    expect(patterns[0]).toMatchObject({
      cadence: "weekly",
      occurrenceCount: 3,
      lastSeenAt: new Date(base + 14 * DAY_MS),
      nextExpectedAt: new Date(base + 21 * DAY_MS),
    });
  });

  it("detects the inclusive edges of the weekly band (5 and 9 days) but not just outside them", () => {
    const base = Date.UTC(2026, 0, 1);
    const insideLower = detectRecurring(series("WeeklyEdgeLow", "-9.99", "EUR", base, [0, 5, 10]));
    const insideUpper = detectRecurring(series("WeeklyEdgeHigh", "-9.99", "EUR", base, [0, 9, 18]));
    const outsideLower = detectRecurring(series("WeeklyOutLow", "-9.99", "EUR", base, [0, 4, 8]));
    const outsideUpper = detectRecurring(series("WeeklyOutHigh", "-9.99", "EUR", base, [0, 10, 20]));
    expect(insideLower[0]).toMatchObject({ cadence: "weekly" });
    expect(insideUpper[0]).toMatchObject({ cadence: "weekly" });
    expect(outsideLower).toHaveLength(0);
    expect(outsideUpper).toHaveLength(0);
  });

  it("detects a biweekly cadence and reports the exact lastSeenAt/nextExpectedAt", () => {
    const base = Date.UTC(2026, 0, 1);
    const patterns = detectRecurring(series("Biweekly Payee", "-12.50", "EUR", base, [0, 14, 28]));
    expect(patterns).toHaveLength(1);
    expect(patterns[0]).toMatchObject({
      cadence: "biweekly",
      occurrenceCount: 3,
      lastSeenAt: new Date(base + 28 * DAY_MS),
      nextExpectedAt: new Date(base + 42 * DAY_MS),
    });
  });

  it("detects a quarterly cadence and reports the exact lastSeenAt/nextExpectedAt", () => {
    const base = Date.UTC(2026, 0, 1);
    const patterns = detectRecurring(series("Quarterly Payee", "-99.00", "EUR", base, [0, 90, 180]));
    expect(patterns).toHaveLength(1);
    expect(patterns[0]).toMatchObject({
      cadence: "quarterly",
      occurrenceCount: 3,
      lastSeenAt: new Date(base + 180 * DAY_MS),
      nextExpectedAt: new Date(base + 270 * DAY_MS),
    });
  });

  it("detects an annual cadence and reports the exact lastSeenAt/nextExpectedAt", () => {
    const base = Date.UTC(2026, 0, 1);
    const patterns = detectRecurring(series("Annual Payee", "-1200.00", "EUR", base, [0, 365, 730]));
    expect(patterns).toHaveLength(1);
    expect(patterns[0]).toMatchObject({
      cadence: "annual",
      occurrenceCount: 3,
      lastSeenAt: new Date(base + 730 * DAY_MS),
      nextExpectedAt: new Date(base + 1095 * DAY_MS),
    });
  });

  it("keeps a debit series and a same-magnitude credit series separate under one payee", () => {
    // Interleaved every 15 days — debit on day 0/30/60, a same-size credit
    // (e.g. a refund) on day 15/45/75. Read sign-blind, this is one uniform
    // 15-day series of 6 occurrences (a false "biweekly" pattern at the same
    // magnitude); a debit and an unrelated credit must never combine into one
    // reported pattern.
    const base = Date.UTC(2026, 0, 1);
    const debit = series("Landlord", "-20.00", "EUR", base, [0, 30, 60]);
    const credit = series("Landlord", "20.00", "EUR", base, [15, 45, 75]);
    const patterns = detectRecurring([...debit, ...credit]);
    expect(patterns).toHaveLength(2);
    expect(patterns.every((p) => p.occurrenceCount === 3 && p.cadence === "monthly")).toBe(true);
    expect(patterns.map((p) => p.amountLow).sort()).toEqual(["20.00", "20.00"]);
    // A1: the two groups differ only by sign — the persisted uniqueness
    // constraint keys on this field precisely so they never collide.
    expect(patterns.map((p) => p.sign).sort()).toEqual(["+", "-"]);
  });

  it("keeps two currencies for the same payee separate, never merged", () => {
    // Interleaved every 15 days across currencies — read currency-blind this
    // is one uniform 15-day (biweekly) series of 6 occurrences at the same
    // magnitude, reporting whichever currency happened to occur last. EUR and
    // USD are not commensurable and must never be compared or merged.
    const base = Date.UTC(2026, 0, 1);
    const eur = series("Freelance Co", "500.00", "EUR", base, [0, 30, 60]);
    const usd = series("Freelance Co", "500.00", "USD", base, [15, 45, 75]);
    const patterns = detectRecurring([...eur, ...usd]);
    expect(patterns).toHaveLength(2);
    expect(patterns.map((p) => p.currency).sort()).toEqual(["EUR", "USD"]);
    expect(patterns.every((p) => p.occurrenceCount === 3 && p.cadence === "monthly")).toBe(true);
    // Both series are credits — currency alone tells them apart here, not sign.
    expect(patterns.every((p) => p.sign === "+")).toBe(true);
  });
});
