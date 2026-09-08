import { describe, expect, it } from "vitest";
import { addQuantity, quantityFromFraction, toDays, toHours } from "./units";

describe("toDays", () => {
  it("converts hours with the type's hours per day", () => {
    expect(toDays("16.00", "8.00")).toBe("2.00");
  });

  it("keeps a half day exact", () => {
    expect(toDays("12.00", "8.00")).toBe("1.50");
  });

  it("honours a non-default working day", () => {
    expect(toDays("15.00", "7.50")).toBe("2.00");
  });

  it("rounds to two places rather than truncating", () => {
    expect(toDays("1.00", "3.00")).toBe("0.33");
    expect(toDays("2.00", "3.00")).toBe("0.67");
  });

  it("refuses a zero working day instead of returning Infinity", () => {
    expect(() => toDays("8.00", "0.00")).toThrow(/hoursPerDay/);
  });

  it("refuses a value that is not a decimal", () => {
    expect(() => toDays("NaN", "8.00")).toThrow(/not a decimal/);
  });
});

describe("toHours", () => {
  it("is the inverse of toDays for whole days", () => {
    expect(toHours("2.00", "8.00")).toBe("16.00");
    expect(toHours("0.50", "8.00")).toBe("4.00");
  });
});

describe("addQuantity", () => {
  it("keeps null when there is no figure on either side", () => {
    expect(addQuantity(null, null)).toBeNull();
  });

  it("treats a missing side as zero once the other one exists", () => {
    expect(addQuantity("8.00", null)).toBe("8.00");
    expect(addQuantity(null, "8.00")).toBe("8.00");
  });

  it("adds in hundredths, not in floats", () => {
    expect(addQuantity("0.10", "0.20")).toBe("0.30");
  });
});

describe("quantityFromFraction", () => {
  it("charges a half day half the working day", () => {
    expect(quantityFromFraction("0.50", "8.00")).toBe("4.00");
  });

  it("charges a full day the whole working day", () => {
    expect(quantityFromFraction("1.00", "8.00")).toBe("8.00");
  });
});
