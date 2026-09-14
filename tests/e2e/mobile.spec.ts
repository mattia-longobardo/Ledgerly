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
  // The sheet sits above the tab bar, which stays in view.
  await expect(tabs.getByRole("button", { name: "More" })).toBeInViewport();
  await sheet.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
});
