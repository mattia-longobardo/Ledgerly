// tests/e2e/auth.spec.ts
import { expect, test } from "@playwright/test";
import { USERS } from "./env";
import { pageAlert, signInWithPassword } from "./helpers";

test("anonymous visitors are sent to sign-in", async ({ page }) => {
  await page.goto("/settings/profile");
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("a wrong password is refused with a message", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(USERS.owner.email);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(pageAlert(page)).toHaveText("Wrong email or password.");
});

test("the first user is admin, reaches the app and signs out", async ({ page }) => {
  await signInWithPassword(page, USERS.owner.email, USERS.owner.password);
  await expect(page.getByRole("heading", { name: "No data yet" })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav.getByRole("link", { name: "Components" })).toBeVisible();
  await page.goto("/components");
  await expect(page.getByRole("heading", { name: "Colour tokens" })).toBeVisible();
  await nav.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
});
