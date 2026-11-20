import { describe, expect, it } from "vitest";
import { MixedCurrencyError, sumMoney } from "./money";

const eur = (cents: bigint) => ({ money: { cents, currency: "EUR" }, on: null });
const usd = (cents: bigint, on: string) => ({ money: { cents, currency: "USD" }, on });

describe("sumMoney", () => {
  it("adds the amounts of the target currency as they are, with no conversion", () => {
    expect(sumMoney([eur(1_00n), eur(-25n)], "EUR")).toEqual({ total: 75n, partial: false });
    expect(sumMoney([], "EUR")).toEqual({ total: 0n, partial: false });
  });

  it("refuses a mix it has no way to convert", () => {
    expect(() => sumMoney([eur(1_00n), usd(1_00n, "2026-03-02")], "EUR")).toThrow(MixedCurrencyError);
  });

  it("converts every other currency at its own day", () => {
    const rate = { "2026-03-02": 90n, "2026-03-03": 80n } as Record<string, bigint>;
    const convert = (money: { cents: bigint }, on: string | null) => (money.cents * rate[on ?? ""]) / 100n;
    expect(
      sumMoney([eur(10_00n), usd(10_00n, "2026-03-02"), usd(10_00n, "2026-03-03")], "EUR", convert),
    ).toEqual({ total: 27_00n, partial: false });
  });

  it("leaves out an amount with no rate and says the total is partial", () => {
    expect(sumMoney([eur(10_00n), usd(10_00n, "2026-03-02")], "EUR", () => null)).toEqual({
      total: 10_00n,
      partial: true,
    });
  });
});
