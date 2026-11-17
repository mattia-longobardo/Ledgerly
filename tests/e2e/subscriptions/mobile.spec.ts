// tests/e2e/subscriptions/mobile.spec.ts — the flow `subscriptions` at the width of a phone (400 px: the project
// `mobile` of playwright.config.ts runs every `mobile.spec.ts`).
import { expect, test } from "@playwright/test";
import { sessionState } from "../_shared/env";

/** The Subscriptions page at 400 px (spec §8.2, §11): the table becomes a list. */
test.describe("subscriptions on a phone", () => {
  test.use({ storageState: sessionState("subscriptions") });

  test("the subscriptions are a list and the page fits the screen", async ({ page }) => {
    await page.goto("/subscriptions");
    // The top bar keeps the primary action inside the screen; the suggestions move into the page.
    const add = page.getByRole("button", { name: "Add subscription" });
    await expect(add).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole("button", { name: /Suggest from recurring payments/ })).toBeInViewport();
    await expect(page.getByRole("columnheader", { name: "Billing" })).toBeHidden();
    await expect(page.getByTestId("subscription-item").filter({ hasText: "Netflix" })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
