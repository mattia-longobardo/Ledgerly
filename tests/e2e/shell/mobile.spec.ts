// tests/e2e/shell/mobile.spec.ts — the flow `shell` at the width of a phone (400 px: the project
// `mobile` of playwright.config.ts runs every `mobile.spec.ts`).
import { expect, test } from "@playwright/test";
import { passwordOf, USERS } from "../_shared/env";
import { previewClient, signInWithPassword } from "../_shared/helpers";

test.use({ extraHTTPHeaders: previewClient(3) });

test("phones get bottom tabs and a More sheet instead of the sidebar @site", async ({ page }) => {
  await signInWithPassword(page, USERS.owner.email, passwordOf(USERS.owner.email));
  const tabs = page
    .getByRole("navigation", { name: "Primary" })
    .filter({ has: page.getByRole("button", { name: "More" }) });
  await expect(tabs.getByRole("link", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("Ledgerly", { exact: true })).toBeHidden();
  await tabs.getByRole("button", { name: "More" }).click();
  const sheet = page.getByRole("dialog", { name: "More" });
  await expect(
    sheet.getByRole("group", { name: "System" }).getByRole("link", { name: "Settings" }),
  ).toBeVisible();
  // The sheet sits above the tab bar instead of covering it (the open modal hides the bar from the
  // accessibility tree, so it is found by its markup here).
  const bar = await page
    .locator("nav", { has: page.locator('button[aria-haspopup="dialog"]') })
    .boundingBox();
  await expect
    .poll(async () => {
      const box = await sheet.boundingBox();
      return box && box.y + box.height;
    })
    .toBe(bar!.y);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  // Accounts is one of the bottom tabs, and its page fits a 400 px screen without sideways
  // scrolling (spec §8.2). Checked inside this test rather than its own: the run's password
  // sign-ins are all spoken for (tests/e2e/_shared/env.ts).
  await tabs.getByRole("link", { name: "Accounts" }).click();
  await expect(page).toHaveURL("/accounts");
  await expect(page.getByRole("heading", { name: "No accounts yet" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  await tabs.getByRole("button", { name: "More" }).click();
  await page.getByRole("dialog", { name: "More" }).getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
});
