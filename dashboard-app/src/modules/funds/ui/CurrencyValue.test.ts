import { describe, expect, it } from "vitest";
import { formatCurrency, formatSignedCurrency } from "./CurrencyValue";

describe("exact Funds currency text", () => {
  it.each([
    ["90000000000000.01", "90.000.000.000.000,01\u00a0€", "+90.000.000.000.000,01\u00a0€"],
    ["99999999999999.99", "99.999.999.999.999,99\u00a0€", "+99.999.999.999.999,99\u00a0€"],
    ["-90000000000000.01", "-90.000.000.000.000,01\u00a0€", "−90.000.000.000.000,01\u00a0€"],
    ["-99999999999999.99", "-99.999.999.999.999,99\u00a0€", "−99.999.999.999.999,99\u00a0€"],
    ["120000000000000.01", "120.000.000.000.000,01\u00a0€", "+120.000.000.000.000,01\u00a0€"],
    ["-120000000000000.01", "-120.000.000.000.000,01\u00a0€", "−120.000.000.000.000,01\u00a0€"],
    ["-0.01", "-0,01\u00a0€", "−0,01\u00a0€"],
    ["0.00", "0,00\u00a0€", "0,00\u00a0€"],
    ["1.2", "1,20\u00a0€", "+1,20\u00a0€"],
  ])("preserves every cent of %s", (value, plain, signed) => {
    expect(formatCurrency(value, "EUR")).toBe(plain);
    expect(formatSignedCurrency(value, "EUR")).toBe(signed);
  });

  it("keeps currency-specific placement and exact fallback text", () => {
    expect(formatCurrency("90000000000000.01", "USD")).toBe("90.000.000.000.000,01\u00a0USD");
    expect(formatCurrency("-99999999999999.99", "invalid")).toBe("-99999999999999.99 invalid");
    expect(formatCurrency(12345.67, "USD")).toBe("12.345,67\u00a0USD");
  });

  it.each([null, undefined, "", "not money", Number.NaN, Number.POSITIVE_INFINITY])("withholds invalid or missing %s", (value) => {
    expect(formatCurrency(value, "EUR")).toBe("—");
    expect(formatSignedCurrency(value, "EUR")).toBe("—");
  });
});
