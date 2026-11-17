// tests/e2e/pockets/mobile.spec.ts — the flow `pockets` at the width of a phone (400 px: the project
// `mobile` of playwright.config.ts runs every `mobile.spec.ts`).
import { expect, test } from "@playwright/test";
import { sessionState } from "../_shared/env";

/** The Pockets pages at 400 px (spec §8.2, §11): the cards, then a pocket's page, nothing sideways. */
test.describe("pockets on a phone", () => {
  test.use({ storageState: sessionState("pockets") });

  test("the cards lead to the pocket's page and both fit the screen", async ({ page }) => {
    const overflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.goto("/pockets");
    await expect(page.getByTestId("pocket-card").first()).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.getByTestId("pocket-card").filter({ hasText: "Holidays" }).click();
    await expect(page.getByTestId("pocket-detail")).toBeVisible();
    await expect(page.getByTestId("pocket-expenses")).toContainText("Ischia");
    expect(await overflow()).toBeLessThanOrEqual(0);
  });
});
