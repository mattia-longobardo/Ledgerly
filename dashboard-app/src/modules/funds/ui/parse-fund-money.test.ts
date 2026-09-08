import { describe, expect, it } from "vitest";
import { parseFundMoney } from "./parse-fund-money";

describe("parseFundMoney", () => {
  it.each([
    ["99999999999998.99", "99999999999998.99"],
    ["90000000000000.01", "90000000000000.01"],
    ["99999999999999.99", "99999999999999.99"],
    ["-99999999999999.99", "-99999999999999.99"],
    ["1.234,56", "1234.56"],
    ["1.234.567,8", "1234567.80"],
    ["1234,56", "1234.56"],
    ["1234.5", "1234.50"],
    ["  00042  ", "42.00"],
    ["0", "0.00"],
    ["-0,00", "0.00"],
  ])("canonicalizes %j without losing cents", (raw, expected) => {
    expect(parseFundMoney(raw)).toBe(expected);
  });

  it.each([
    null,
    "",
    "   ",
    "100000000000000.00",
    "-100000000000000.00",
    "1e3",
    "1.234",
    "1234.567",
    "1.234,567",
    "12.34,56",
    "1.23.456,78",
    "1,234.56",
    "1..234,56",
    "1234,",
    ",50",
    "1 234,56",
    "€ 12,50",
  ])("rejects unsupported or malformed input %j", (raw) => {
    expect(parseFundMoney(raw)).toBeNull();
  });

  it("rejects file form entries", () => {
    expect(parseFundMoney(new File(["12.50"], "amount.txt"))).toBeNull();
  });
});
