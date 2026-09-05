import { describe, expect, it } from "vitest";
import { addMoney } from "./money";

describe("addMoney", () => {
  it("adds two decimal strings exactly, without going through a float", () => {
    expect(addMoney("0.10", "0.20")).toBe("0.30");
    expect(addMoney("1800.55", "244.45")).toBe("2045.00");
    expect(addMoney("2500.00", "1800.00")).toBe("4300.00");
  });

  it("treats a missing half as absent, not as zero, until both are missing", () => {
    expect(addMoney("100.00", null)).toBe("100.00");
    expect(addMoney(null, "100.00")).toBe("100.00");
    expect(addMoney(null, null)).toBeNull();
  });

  it("normalises the scale of an input that carries fewer decimals", () => {
    expect(addMoney("100", "0.5")).toBe("100.50");
  });

  it("handles a negative total", () => {
    expect(addMoney("-100.00", "40.00")).toBe("-60.00");
    expect(addMoney("-0.05", "-0.05")).toBe("-0.10");
  });

  it("throws on a value that is not a decimal, rather than silently producing NaN", () => {
    expect(() => addMoney("1.800,00", "1.00")).toThrow(/not a decimal/);
  });
});
