// tests/e2e/preferences.spec.ts
import { expect, type Page, test } from "@playwright/test";
import { USERS } from "./env";
import { signInWithPassword } from "./helpers";

/** The next Server Action POST (the theme toggle saves in a transition). */
function nextActionResponse(page: Page) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && response.request().headers()["next-action"] !== undefined,
  );
}

// One sign-in for the whole journey: the suite's password sign-ins are at Better Auth's per-client
// limit (tests/e2e/env.ts).
test("theme and language preferences apply at once, persist, and come from the account", async ({ page }) => {
  const html = page.locator("html");
  await signInWithPassword(page, USERS.prefs.email, USERS.prefs.password);
  await expect(html).toHaveAttribute("data-theme", "light");

  await page.goto("/settings/profile");
  const preferences = page.locator("form", { has: page.locator("#language") });

  await test.step("the topbar toggle and the preferences form agree without a reload", async () => {
    const themeSaved = nextActionResponse(page);
    await page.getByRole("button", { name: "Toggle theme" }).click();
    await expect(html).toHaveAttribute("data-theme", "dark");
    expect((await themeSaved).ok()).toBe(true);
    await expect(page.getByLabel("Theme", { exact: true })).toHaveValue("dark");

    await page.getByLabel("Language").selectOption("it");
    await preferences.getByRole("button", { name: "Save" }).click();
    await expect(
      page.getByRole("navigation", { name: "Principale" }).getByRole("link", { name: "Panoramica" }),
    ).toBeVisible();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(page.getByLabel("Tema", { exact: true })).toHaveValue("dark");
  });

  await test.step("the account's preferences win over missing cookies", async () => {
    await page.context().clearCookies({ name: "theme" });
    await page.context().clearCookies({ name: "locale" });
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(html).toHaveAttribute("lang", "it");
  });

  await test.step("System follows the OS colour scheme while the page is open", async () => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.getByLabel("Tema", { exact: true }).selectOption("system");
    await preferences.getByRole("button", { name: "Salva" }).click();
    await expect(html).toHaveAttribute("data-theme", "light");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(html).toHaveAttribute("data-theme", "dark");
  });
});
