// tests/e2e/addons/a11y.spec.ts — the screens of the flow `addons` in the layout and accessibility
// check: what is measured, and why, is in tests/e2e/_shared/a11y.ts.
import { test } from "@playwright/test";
import { audit, go, type Screen } from "../_shared/a11y";

const PAGES: Screen[] = [
  { name: "/settings/addons", session: "layout", open: go("/settings/addons") },
  {
    name: "/settings/addons (sent by a page that is off)",
    session: "layout",
    open: go("/settings/addons?off=budgets"),
  },
  {
    name: "/settings/addons (the question before an addon goes off)",
    session: "layout",
    open: async (page) => {
      await go("/settings/addons")(page);
      await page.getByRole("switch", { name: "Payroll", exact: true }).click();
      await page.getByRole("dialog").waitFor();
    },
    roots: ["[role=dialog]"],
  },
  { name: "/settings/notifications", session: "layout", open: go("/settings/notifications") },
  // Overview with «To do»: the `review` user has transactions to categorize.
  { name: "/ (with To do)", session: "review", open: go("/") },
  { name: "/settings/profile (amounts hidden)", session: "hidden", open: go("/settings/profile") },
];

test.describe("every screen", () => audit(PAGES));
