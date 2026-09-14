// tests/e2e/auth.spec.ts
import { expect, test } from "@playwright/test";
import { USERS } from "./env";
import { pageAlert, signInWithPassword } from "./helpers";

test("anonymous visitors are sent to sign-in", async ({ page }) => {
  await page.goto("/settings/profile");
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page).toHaveTitle("Sign in · Finance Dashboard");
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
  await expect(page).toHaveTitle("Overview · Finance Dashboard");
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav.getByRole("link", { name: "Components" })).toBeVisible();
  await page.goto("/components");
  await expect(page.getByRole("heading", { name: "Color tokens" })).toBeVisible();

  await page.goto("/settings/profile");
  const topbar = page.getByRole("banner");
  await expect(topbar.getByRole("link", { name: "Settings" })).toBeVisible();
  await expect(topbar.getByText("Profile", { exact: true })).toBeVisible();
  await expect(page.getByText("Role: Admin")).toBeVisible();
  await expect(page.getByText("Sign-in method: Local password")).toBeVisible();
  await expect(page.getByLabel("Current password")).toBeVisible();
  await page.goto("/settings/security");
  await expect(page.getByText("Active now")).toBeVisible();
  await expect(page.getByLabel("Current password")).toHaveCount(0);

  await nav.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
});
