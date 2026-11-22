// tests/e2e/addons/a11y.spec.ts — the screens of the flow `addons` in the layout and accessibility
// check: what is measured, and why, is in tests/e2e/_shared/a11y.ts.
import { type Page, test } from "@playwright/test";
import { audit, go, type Screen } from "../_shared/a11y";
import { hydrated } from "../_shared/helpers";

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
  // The first start (R5a): its three steps. `welcome` never ends it, so the answer of the second step
  // is the browser's own: the user keeps the first start ahead of it for the next check.
  { name: "/welcome (country and format)", session: "welcome", open: welcomeStep(1) },
  { name: "/welcome (addons)", session: "welcome", open: welcomeStep(2) },
  { name: "/welcome (first account)", session: "welcome", open: welcomeStep(3) },
];

/** The first start at its `step`, reached with Continue. */
function welcomeStep(step: 1 | 2 | 3) {
  return async (page: Page) => {
    await page.route("**/api/v1/onboarding", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ json: { pending: false, country: null, proposal: null } })
        : route.fallback(),
    );
    await go("/welcome")(page);
    await page.getByLabel("Country", { exact: true }).waitFor();
    for (let at = 1; at < step; at++) {
      const next = page.getByRole("button", { name: "Continue" });
      await hydrated(next);
      await next.click();
      await page
        .getByRole("heading", { level: 1, name: at === 1 ? "Addons" : "Your first account" })
        .waitFor();
    }
    if (step === 3) await page.getByLabel("Name", { exact: true }).waitFor();
  };
}

test.describe("every screen", () => audit(PAGES));
