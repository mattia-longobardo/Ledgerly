// tests/e2e/accounts/keyboard.spec.ts — the keyboard checks of the flow `accounts`; what the
// keyboard checks of every flow share is in tests/e2e/_shared/keyboard.ts.
import { expect, type Locator, test } from "@playwright/test";
import { focusIsVisible, focusOn } from "../_shared/keyboard";
import { sessionState } from "../_shared/env";

test.use({ storageState: sessionState("layout") });

test("a sortable table sorts from the keyboard, and the column says which way", async ({ page }) => {
  await page.goto("/expenses");

  const header: Locator = page.getByRole("columnheader").filter({ hasText: "Amount" }).first();
  const button = header.getByRole("button").first();
  await focusOn(button);
  expect(await focusIsVisible(page), "the sort control draws no ring").toBe(true);

  const before = await header.getAttribute("aria-sort");
  await page.keyboard.press("Enter");
  await expect
    .poll(
      () => page.getByRole("columnheader").filter({ hasText: "Amount" }).first().getAttribute("aria-sort"),
      {
        message: "Enter on the header changed no sort",
      },
    )
    .not.toBe(before);
});

test("«Import CSV» opens from the keyboard, and Escape gives the focus back", async ({ page }) => {
  await page.goto("/accounts");
  // The page is opened by its address, not by a click: a click would leave the browser in pointer
  // mode, and the ring is drawn for the keyboard only.
  const href = await page.getByRole("link", { name: "Revolut Saving" }).first().getAttribute("href");
  await page.goto(href ?? "/accounts");
  const button = page.getByRole("button", { name: "Import CSV" });
  await focusOn(button);
  expect(await focusIsVisible(page), "the button draws no ring").toBe(true);
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Import a CSV file" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(button).toBeFocused();
});
