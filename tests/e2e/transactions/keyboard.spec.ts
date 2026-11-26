// tests/e2e/transactions/keyboard.spec.ts — the keyboard checks of the flow `transactions`; what the
// keyboard checks of every flow share is in tests/e2e/_shared/keyboard.ts.
import { expect, test } from "@playwright/test";
import { dialogHasFocus, focusIsVisible, focusOn, tabUntil } from "../_shared/keyboard";
import { sessionState } from "../_shared/env";

test.use({ storageState: sessionState("layout") });

// The row's «⋯» menu is gone (owner, 2026-11-26): the row itself opens its edit dialog.
test("a row opens its edit dialog on Enter, keeps the focus inside and gives it back on Escape", async ({
  page,
}) => {
  await page.goto("/expenses");
  const row = page.locator("tbody tr[tabindex='0']").first();
  await focusOn(row);
  expect(await focusIsVisible(page), "the focused row draws no ring").toBe(true);
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Edit", exact: true });
  await expect(dialog).toBeVisible();
  await dialogHasFocus(page);
  // Thirty Tabs go round the dialog more than once: the focus never leaves it.
  const outside = () =>
    page.evaluate(() => !document.querySelector('[role="dialog"]')?.contains(document.activeElement));
  expect(await tabUntil(page, 30, outside), "the focus left the dialog").toBe(-1);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(row).toBeFocused();
});
