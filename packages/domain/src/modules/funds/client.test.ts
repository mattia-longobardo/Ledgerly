// The redirects of the old addresses are read from the browser's entry (rewrite plan R3): its names answer as
// the module's do.
import { describe, expect, it } from "vitest";
import { isFutureYear, legacyFundQuery } from "./client";

const TODAY = "2028-06-15";

describe("the browser's entry of Funds", () => {
  it("says a year still to come is in the future, and the year running is not", () => {
    expect(isFutureYear("2029", TODAY)).toBe(true);
    expect(isFutureYear("2028", TODAY)).toBe(false);
    expect(isFutureYear(undefined, TODAY)).toBe(false);
  });

  it("sends an old span of months to the new period", () => {
    expect(legacyFundQuery({ span: "60" }, TODAY)).toEqual({ preset: "all" });
    expect(legacyFundQuery({}, TODAY)).toBeNull();
  });
});
