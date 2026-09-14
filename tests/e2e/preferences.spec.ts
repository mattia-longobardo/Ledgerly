// tests/e2e/preferences.spec.ts
import { expect, test } from "@playwright/test";
import { USERS } from "./env";
import { signInWithPassword } from "./helpers";

test("language and theme preferences apply and persist", async ({ page }) => {
  await signInWithPassword(page, USERS.prefs.email, USERS.prefs.password);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  // The toggle flips the attribute and the cookie at once, then saves in a transition (a Server
  // Action POST): reload only once that save has answered, or the reload could abort it.
  const themeSaved = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && response.request().headers()["next-action"] !== undefined,
  );
  await page.getByRole("button", { name: "Toggle theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect((await themeSaved).ok()).toBe(true);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.goto("/settings/profile");
  await expect(page.getByLabel("Theme", { exact: true })).toHaveValue("dark");
  await page.getByLabel("Language").selectOption("it");
  // Profile has two forms with a Save button; take the preferences one (the form holding "Language").
  await page
    .locator("form", { has: page.getByLabel("Language") })
    .getByRole("button", { name: "Save" })
    .click();
  await expect(
    page.getByRole("navigation", { name: "Principale" }).getByRole("link", { name: "Panoramica" }),
  ).toBeVisible();
});
