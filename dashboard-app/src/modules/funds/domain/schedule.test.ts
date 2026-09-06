import { describe, expect, it } from "vitest";
import { accrualPeriodFor, effectiveRule, postedMonthFor } from "./schedule";

const quarterly = {
  frequency: "quarterly" as const,
  periodAnchorMonth: 1,
  postingLagMonths: 1,
  feePerPosting: "3.00",
};

describe("quarterly posting rule (spec §7.4, R5-2)", () => {
  it("posts the March quarter in April", () => {
    expect(accrualPeriodFor("2026-03-01", quarterly)).toEqual({
      start: "2026-01-01",
      end: "2026-03-01",
    });
    expect(postedMonthFor("2026-01-01", quarterly)).toBe("2026-04-01");
    expect(postedMonthFor("2026-03-01", quarterly)).toBe("2026-04-01");
  });

  it("posts Q4 in January of the next year", () => {
    expect(postedMonthFor("2025-12-01", quarterly)).toBe("2026-01-01");
  });

  it("honours an anchor month: quarters starting in February", () => {
    expect(accrualPeriodFor("2026-01-01", { ...quarterly, periodAnchorMonth: 2 })).toEqual({
      start: "2025-11-01",
      end: "2026-01-01",
    });
  });

  it("monthly with lag 0 posts in the accrual month", () => {
    expect(postedMonthFor("2026-05-01", {
      ...quarterly,
      frequency: "monthly",
      postingLagMonths: 0,
    })).toBe("2026-05-01");
  });

  it("annual with anchor 1 posts the whole year in January + lag", () => {
    expect(postedMonthFor("2026-07-01", { ...quarterly, frequency: "annual" })).toBe("2027-01-01");
  });

  it("picks the latest rule effective at the month, or null", () => {
    const rules = [
      { effectiveFrom: "2026-01-01", n: 1 },
      { effectiveFrom: "2026-06-01", n: 2 },
    ];
    expect(effectiveRule(rules, "2026-05-01")?.n).toBe(1);
    expect(effectiveRule(rules, "2026-06-01")?.n).toBe(2);
    expect(effectiveRule(rules, "2025-12-01")).toBeNull();
  });
});
