// tests/e2e/timeoff/a11y.spec.ts — the screens of the flow `timeoff` in the layout and
// accessibility check: what is measured, and why, is in tests/e2e/_shared/a11y.ts.
import { expect, test } from "@playwright/test";
import { audit, finished, go, type Screen, settled, settledDialog } from "../_shared/a11y";

const PAGES: Screen[] = [
  { name: "/timeoff", session: "layout", smoke: true, open: go("/timeoff") },
  { name: "/timeoff/settings", session: "layout", open: go("/timeoff/settings") },
  {
    // A range with its first day chosen: the preview under the pointer and the bar (rewrite plan N5).
    name: "/timeoff, a range in progress",
    session: "layout",
    open: async (page) => {
      await page.goto("/timeoff");
      await settled(page);
      const free = page.locator('[data-month="3"] [data-testid="free-cell"]');
      await free.nth(0).click();
      await free.nth(6).hover();
      await expect(page.getByTestId("selection-bar")).toBeVisible();
      await finished(page);
    },
  },
];

const OVERLAYS: Screen[] = [
  {
    // The leave panel on a range that crosses a weekend, so the summary has every kind of line.
    name: "the leave panel, a new range",
    session: "layout",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await page.goto("/timeoff");
      await settled(page);
      const free = page.locator('[data-month="3"] [data-testid="free-cell"]');
      await free.nth(0).click();
      await free.nth(6).click();
      await settledDialog(page);
    },
  },
  {
    // The same panel on a booked day: the row's badges, Remove, and the residual of an edit.
    name: "the leave panel, a booked day",
    session: "layout",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await page.goto("/timeoff");
      await settled(page);
      await page.getByTestId("leave-cell").first().click();
      await settledDialog(page);
    },
  },
  {
    // The list "Remove N days" shows before it writes (17/11/2026): reached without writing.
    name: "the leave panel, the days a range removes",
    session: "layout",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await page.goto("/timeoff");
      await settled(page);
      const booked = page.getByTestId("leave-cell").first();
      await booked.click();
      await page.getByRole("button", { name: "Select more days from here" }).click();
      await expect(page.getByTestId("selection-bar")).toBeVisible();
      await booked.click();
      await page
        .getByRole("dialog", { name: "New leave" })
        .getByRole("button", { name: /^Remove \d+ days?$/ })
        .click();
      await expect(page.getByRole("dialog", { name: "Remove leave" })).toBeVisible();
      await settledDialog(page);
    },
  },
];

test.describe("every screen", () => audit(PAGES));
test.describe("every overlay", () => audit(OVERLAYS));
