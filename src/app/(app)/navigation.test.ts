import { describe, expect, it } from "vitest";
import { navFor } from "./navigation";

describe("navFor", () => {
  it("hides admin-only items from users", () => {
    expect(navFor("user").map((i) => i.id)).toEqual([
      "overview",
      "accounts",
      "expenses",
      "budgets",
      "funds",
      "interests",
      "pockets",
      "subscriptions",
      "payroll",
      "timeoff",
      "settings",
    ]);
    expect(navFor("admin").map((i) => i.id)).toEqual([
      "overview",
      "accounts",
      "expenses",
      "budgets",
      "funds",
      "interests",
      "pockets",
      "subscriptions",
      "payroll",
      "timeoff",
      "settings",
    ]);
  });
});

describe("the mobile tab bar", () => {
  /**
   * The bar is five cells wide and the fifth belongs to More (spec §8.2: "schede in basso
   * Overview · Accounts · Expenses · Payroll · More"). A fifth `mobile` item takes that cell,
   * so More is placed in an implicit second row that the bar's fixed height clips — which is
   * what `timeoff` did to it from F7 until this test.
   */
  it("leaves the fifth cell to More, so four items at most are tabs", () => {
    for (const role of ["user", "admin"] as const) {
      expect(
        navFor(role)
          .filter((item) => item.mobile)
          .map((item) => item.id),
      ).toEqual(["overview", "accounts", "expenses", "payroll"]);
    }
  });
});
