import { describe, expect, it } from "vitest";
import { detectRecurring, type RecurringCandidate } from "./recurring";

function monthly(payee: string, amount: string, months: number[]): RecurringCandidate[] {
  return months.map((m) => ({ payee, amount, currency: "EUR", occurredAt: new Date(Date.UTC(2026, m, 1)) }));
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
});
