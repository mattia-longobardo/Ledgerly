// tests/e2e/budgets/mobile.spec.ts — the flow `budgets` at the width of a phone (400 px: the project
// `mobile` of playwright.config.ts runs every `mobile.spec.ts`).
import { expect, test } from "@playwright/test";
import { sessionState } from "../_shared/env";

/** The Budgets journey at 400 px (spec §8.2, §11): the table becomes a list and fits the screen. */
test.describe("budgets on a phone", () => {
  test.use({ storageState: sessionState("budgets") });

  test("the budgets are a list reachable from the More sheet", async ({ page }) => {
    await page.goto("/");
    const tabs = page
      .getByRole("navigation", { name: "Primary" })
      .filter({ has: page.getByRole("button", { name: "More" }) });
    await tabs.getByRole("button", { name: "More" }).click();
    await page.getByRole("dialog", { name: "More" }).getByRole("link", { name: "Budgets" }).click();
    await expect(page).toHaveURL("/budgets");

    await expect(page.getByRole("columnheader", { name: "Budget" })).toBeHidden();
    await expect(page.getByTestId("budget-item").filter({ hasText: "Spesa" })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
