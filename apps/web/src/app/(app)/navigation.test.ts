import { describe, expect, it } from "vitest";
import { navFor } from "./navigation";

const ALL = [
  "overview",
  "accounts",
  "expenses",
  "budgets",
  "subscriptions",
  "investments",
  "pockets",
  "interests",
  "payroll",
  "timeoff",
  "settings",
];

describe("navFor", () => {
  it("lists every item, in the order of the three groups, for users and admins", () => {
    expect(navFor("user").map((i) => i.id)).toEqual(ALL);
    expect(navFor("admin").map((i) => i.id)).toEqual(ALL);
  });

  it("puts each item in its group of decision D2", () => {
    const groups = Object.fromEntries(navFor("user").map((i) => [i.id, i.group]));
    expect(groups).toEqual({
      overview: "everyday",
      accounts: "everyday",
      expenses: "everyday",
      budgets: "everyday",
      subscriptions: "everyday",
      investments: "savings",
      pockets: "savings",
      interests: "savings",
      payroll: "work",
      timeoff: "work",
      settings: "footer",
    });
  });

  it("leaves out the addons that are off, never a base module", () => {
    expect(navFor("user", []).map((i) => i.id)).toEqual(["overview", "accounts", "expenses", "settings"]);
    expect(navFor("user", ["payroll", "pockets"]).map((i) => i.id)).toEqual([
      "overview",
      "accounts",
      "expenses",
      "pockets",
      "payroll",
      "settings",
    ]);
  });
});

describe("the mobile tab bar", () => {
  /**
   * The bar is five cells wide and the fifth belongs to More (decision D2d: "Overview · Accounts ·
   * Expenses · Investments · More"). A fifth `mobile` item takes that cell, so More is placed in an
   * implicit second row that the bar's fixed height clips — which is what `timeoff` did to it from F7.
   */
  it("has the four tabs of D2d, and leaves the fifth cell to More", () => {
    for (const role of ["user", "admin"] as const) {
      expect(
        navFor(role)
          .filter((entry) => entry.mobile)
          .map((entry) => entry.id),
      ).toEqual(["overview", "accounts", "expenses", "investments"]);
    }
  });
});
