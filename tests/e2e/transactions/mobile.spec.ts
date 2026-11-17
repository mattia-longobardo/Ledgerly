// tests/e2e/transactions/mobile.spec.ts — the flow `transactions` at the width of a phone (400 px: the project
// `mobile` of playwright.config.ts runs every `mobile.spec.ts`).
import { expect, test } from "@playwright/test";
import { sessionState } from "../_shared/env";

/**
 * The F2 journey at 400 px (spec §11). Its own user, from the seed's session, so it costs none of
 * the run's rate-limited sign-ins (tests/e2e/_shared/env.ts) and has movements to show.
 */
test.describe("expenses on a phone", () => {
  test.use({ storageState: sessionState("expenses") });

  test("the table is shown as a list and fits the screen", async ({ page }) => {
    await page.goto("/expenses");
    await expect(page.getByRole("heading", { name: "Expenses" }).first()).toBeVisible();

    // §8.2: below 768 px the table becomes a list. The table itself is hidden, so its column
    // headers are gone from the accessibility tree and the movements are list items.
    await expect(page.getByRole("columnheader", { name: "Payee" })).toBeHidden();
    const rows = page.getByRole("listitem").filter({ hasText: "Esselunga" });
    await expect(rows.first()).toBeVisible();
    await expect(rows.first()).toContainText("45,50 €");

    // No sideways scrolling, the same bar §8.2 sets for Accounts.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // Expenses is one of the bottom tabs of the design.
    const tabs = page
      .getByRole("navigation", { name: "Primary" })
      .filter({ has: page.getByRole("button", { name: "More" }) });
    await expect(tabs.getByRole("link", { name: "Expenses" })).toBeVisible();
  });
});
