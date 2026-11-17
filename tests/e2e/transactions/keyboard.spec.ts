// tests/e2e/transactions/keyboard.spec.ts — the keyboard checks of the flow `transactions`; what the
// keyboard checks of every flow share is in tests/e2e/_shared/keyboard.ts.
import { expect, test } from "@playwright/test";
import { focused, focusIsVisible, focusOn } from "../_shared/keyboard";
import { sessionState } from "../_shared/env";

test.use({ storageState: sessionState("layout") });

test("a row menu opens on Enter, walks with the arrows and closes on Escape", async ({ page }) => {
  await page.goto("/expenses");

  const trigger = page.getByRole("button", { name: /Actions|Row actions|More/ }).first();
  await focusOn(trigger);
  await page.keyboard.press("Enter");

  const menu = page.getByRole("menu").first();
  await expect(menu).toBeVisible();
  await page.keyboard.press("ArrowDown");
  const first = await focused(page);
  await page.keyboard.press("ArrowDown");
  expect(await focused(page), "the arrows do not move inside the menu").not.toBe(first);
  expect(await focusIsVisible(page), "the menu item under the arrows draws no ring").toBe(true);

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
});
