// tests/e2e/reset.spec.ts
import { expect, test } from "@playwright/test";
import { waitForMail } from "../../test/mailpit";
import { USERS } from "./env";
import { signInWithPassword } from "./helpers";

test("a reset email lets the user choose a new password", async ({ page }) => {
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(USERS.reset.email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText("reset link is on its way");
  const link = /(https?:\/\/\S+)/.exec((await waitForMail(USERS.reset.email)).Text)?.[1];
  expect(link).toBeTruthy();
  await page.goto(link!);
  await expect(page).toHaveURL(/\/reset-password\?token=/);
  await page.getByLabel("New password", { exact: true }).fill("brand-new-password-1");
  await page.getByLabel("Confirm new password").fill("brand-new-password-1");
  await page.getByRole("button", { name: "Set password" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await signInWithPassword(page, USERS.reset.email, "brand-new-password-1");
});
