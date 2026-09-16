// tests/e2e/mobile.spec.ts
import { expect, test } from "@playwright/test";
import { USERS } from "./env";
import { signInWithPassword } from "./helpers";

test("phones get bottom tabs and a More sheet instead of the sidebar", async ({ page }) => {
  await signInWithPassword(page, USERS.owner.email, USERS.owner.password);
  const tabs = page
    .getByRole("navigation", { name: "Primary" })
    .filter({ has: page.getByRole("button", { name: "More" }) });
  await expect(tabs.getByRole("link", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("Finance Dashboard", { exact: true })).toBeHidden();
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
  // sign-ins are all spoken for (tests/e2e/env.ts).
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
