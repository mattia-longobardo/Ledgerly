// tests/e2e/oidc.spec.ts
import { expect, test } from "@playwright/test";
import { signInWithOidc } from "./helpers";

test("an Authentik admin-group member becomes admin on sign-in", async ({ page }) => {
  await signInWithOidc(page, "admin@example.test");
  await expect(
    page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Components" }),
  ).toBeVisible();
});

test("other Authentik users are plain users", async ({ page }) => {
  await signInWithOidc(page, "someone@example.test");
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav.getByRole("link", { name: "Overview" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Components" })).toHaveCount(0);
  const response = await page.goto("/components");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});
