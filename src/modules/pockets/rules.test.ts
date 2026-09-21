import { describe, expect, it } from "vitest";
import { etaMonths, freeBalance, monthEndBalances, pocketBalance, withdrawnSince } from "./rules";

const movements = [
  { kind: "accrual" as const, amountCents: 25_000n, on: "2026-01-01" },
  { kind: "deposit" as const, amountCents: 10_000n, on: "2026-01-20" },
  { kind: "accrual" as const, amountCents: 25_000n, on: "2026-02-01" },
  { kind: "withdrawal" as const, amountCents: -8_500n, on: "2026-02-14" },
  { kind: "accrual" as const, amountCents: 25_000n, on: "2026-04-01" },
];

describe("pocketBalance", () => {
  it("is the sum of the movements", () => {
    expect(pocketBalance(movements)).toBe(76_500n);
    expect(pocketBalance([])).toBe(0n);
  });
});

describe("etaMonths", () => {
  it("rounds the months still needed up", () => {
    expect(etaMonths(400_000n, 325_000n, 25_000n)).toBe(3);
    expect(etaMonths(400_000n, 325_001n, 25_000n)).toBe(3);
    expect(etaMonths(400_000n, 324_999n, 25_000n)).toBe(4);
  });

  it("is zero once the target is reached", () => {
    expect(etaMonths(400_000n, 400_000n, 25_000n)).toBe(0);
    expect(etaMonths(400_000n, 500_000n, null)).toBe(0);
  });

  it("is unknown without a target or without an accrual", () => {
    expect(etaMonths(null, 1n, 25_000n)).toBeNull();
    expect(etaMonths(400_000n, 1n, null)).toBeNull();
  });
});

describe("freeBalance", () => {
  it("counts a shared backing account once and subtracts every pocket on it", () => {
    const balances = new Map([
      ["revolut", 1_000_000n],
      ["ing", 300_000n],
    ]);
    const pockets = [
      { backingAccountId: "revolut", balanceCents: 325_000n },
      { backingAccountId: "revolut", balanceCents: 180_000n },
      { backingAccountId: "ing", balanceCents: 120_000n },
      { backingAccountId: null, balanceCents: 90_000n },
    ];
    expect(freeBalance(balances, pockets)).toEqual({
      backingCents: 1_300_000n,
      earmarkedCents: 625_000n,
      freeCents: 675_000n,
    });
  });

  it("is unknown when a backing account has no balance, and when nothing rests on an account", () => {
    expect(freeBalance(new Map(), [{ backingAccountId: "revolut", balanceCents: 1n }]).freeCents).toBeNull();
    expect(freeBalance(new Map(), [{ backingAccountId: null, balanceCents: 1n }])).toEqual({
      backingCents: null,
      earmarkedCents: 0n,
      freeCents: null,
    });
  });

  it("can go negative: more earmarked than the account holds is worth showing", () => {
    expect(
      freeBalance(new Map([["a", 100n]]), [{ backingAccountId: "a", balanceCents: 150n }]).freeCents,
    ).toBe(-50n);
  });
});

describe("monthEndBalances", () => {
  it("holds the balance at each month end and is unknown before the first movement", () => {
    expect(
      monthEndBalances(movements, ["2025-12-01", "2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01"]),
    ).toEqual([null, 35_000n, 51_500n, 51_500n, 76_500n]);
  });
});

describe("withdrawnSince", () => {
  it("sums the withdrawals on or after the date, as a negative amount", () => {
    expect(withdrawnSince(movements, "2026-02-14")).toBe(-8_500n);
    expect(withdrawnSince(movements, "2026-02-15")).toBe(0n);
  });
});
