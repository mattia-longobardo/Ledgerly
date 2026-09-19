// tests/e2e/helpers.ts
import { expect, type Locator, type Page } from "@playwright/test";

/** The page's own alert message. Next.js also renders an empty `role="alert"` route announcer. */
export function pageAlert(page: Page): Locator {
  return page.getByRole("alert").filter({ hasText: /\S/ });
}

export async function signInWithPassword(page: Page, email: string, password: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL("/");
}
