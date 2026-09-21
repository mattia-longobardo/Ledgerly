import { describe, expect, it } from "vitest";
import { monthRange } from "./range";

const THIS_MONTH = "2026-09-01";

describe("monthRange", () => {
  it("reads two AAAA-MM ends into month keys and counts the months between them", () => {
    expect(monthRange({ from: "2025-10", to: "2026-03" }, THIS_MONTH)).toEqual({
      from: "2025-10-01",
      to: "2026-03-01",
      months: 6,
    });
    expect(monthRange({ from: "2026-09", to: "2026-09" }, THIS_MONTH)).toEqual({
      from: "2026-09-01",
      to: "2026-09-01",
      months: 1,
    });
  });

  it("brings an end in the future back to the current month", () => {
    expect(monthRange({ from: "2026-01", to: "2027-05" }, THIS_MONTH)).toEqual({
      from: "2026-01-01",
      to: "2026-09-01",
      months: 9,
    });
  });

  it("answers null for anything that is not a range, so the preset wins", () => {
    expect(monthRange({}, THIS_MONTH)).toBeNull();
    expect(monthRange({ from: "2026-03" }, THIS_MONTH)).toBeNull();
    expect(monthRange({ from: "2026-05", to: "2026-03" }, THIS_MONTH)).toBeNull();
    expect(monthRange({ from: "2026-13", to: "2026-14" }, THIS_MONTH)).toBeNull();
    expect(monthRange({ from: "2026-03-01", to: "2026-04-01" }, THIS_MONTH)).toBeNull();
    expect(monthRange({ from: ["2026-01", "2026-02"], to: "2026-04" }, THIS_MONTH)).toBeNull();
    // Entirely in the future: nothing has happened there yet.
    expect(monthRange({ from: "2027-01", to: "2027-03" }, THIS_MONTH)).toBeNull();
  });
});
