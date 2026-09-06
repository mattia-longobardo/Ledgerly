import { describe, expect, it } from "vitest";
import type { FundSummary } from "../application/summary";
import { totalFundValue } from "./load-funds";

function summary(currency: string, value: string | null): FundSummary {
  return {
    fund: {
      id: crypto.randomUUID(),
      userId: "user-1",
      slug: crypto.randomUUID(),
      name: "Fund",
      kind: "investment",
      currency,
      accountId: value === null ? null : crypto.randomUUID(),
      status: "active",
      archivedAt: null,
      version: 1,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    },
    value,
    valueAsOf: value === null ? null : "2026-09-01",
    deposited: "0.00",
    absReturn: value,
    lastContributionMonth: null,
    openIssues: 0,
  };
}

describe("totalFundValue", () => {
  it("returns null instead of inventing zero when every valuation is missing", () => {
    expect(totalFundValue([summary("EUR", null), summary("EUR", null)])).toEqual({
      value: null,
      unvalued: 2,
    });
  });

  it("sums known same-currency values and reports partial coverage", () => {
    expect(totalFundValue([
      summary("EUR", "1250.25"),
      summary("EUR", null),
      summary("EUR", "49.75"),
    ])).toEqual({ value: "1300.00", unvalued: 1 });
  });

  it("withholds a mixed-currency total instead of converting or adding it", () => {
    expect(totalFundValue([
      summary("EUR", "100.00"),
      summary("USD", "200.00"),
      summary("GBP", null),
    ])).toEqual({ value: null, unvalued: 1 });
  });
});
