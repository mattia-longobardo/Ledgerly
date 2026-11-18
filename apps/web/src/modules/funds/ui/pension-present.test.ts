import { describe, expect, it } from "vitest";
import { periodLabel, quarterLabel } from "./pension-present";

describe("periodLabel", () => {
  const quarter = ({ index, year }: { index: number; year: number }) => `Q${index} ${year}`;

  it("names a month of a source that accrues by month", () => {
    expect(periodLabel("month", 2026, 10, "en", quarter)).toBe("October 2026");
    expect(periodLabel("month", 2026, 1, "it", quarter)).toBe("gennaio 2026");
  });

  it("names a quarter with the message it is given", () => {
    expect(periodLabel("quarter", 2026, 3, "en", quarter)).toBe("Q3 2026");
  });

  it("falls back to the quarter as the fund's documents write it", () => {
    expect(periodLabel("quarter", 2026, 2, "it")).toBe(quarterLabel(2026, 2));
    expect(quarterLabel(2026, 4)).toBe("IV 2026");
  });
});
