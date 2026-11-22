// The period of the address is read from the browser's entry (rewrite plan R3): its names answer as the
// module's do.
import { describe, expect, it } from "vitest";
import { legacyPeriodQuery, sectionPeriod } from "./client";

const TODAY = "2028-06-15";

describe("the browser's entry of Investments", () => {
  it("sends the old range of the charts to the new period", () => {
    expect(legacyPeriodQuery({ range: "all" }, TODAY)).toEqual({ preset: "all" });
    expect(legacyPeriodQuery({ preset: "ytd" }, TODAY)).toBeNull();
  });

  it("reads the period of the address", () => {
    expect(sectionPeriod({ preset: "all" }, TODAY).preset).toBe("all");
    expect(sectionPeriod({ from: "2028-01-01", to: "2028-03-31" }, TODAY).preset).toBeNull();
  });
});
