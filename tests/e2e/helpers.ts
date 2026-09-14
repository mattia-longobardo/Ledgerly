// tests/e2e/helpers.ts
import { readFileSync } from "node:fs";
import { expect, type Locator, type Page } from "@playwright/test";
import { INVITATIONS, STATE_DIR } from "./env";

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

/** The mock provider's login form (compose.dev.yml `oidc`). The only place that knows its markup. */
export async function completeMockOidcLogin(page: Page, subject: string) {
  await page.locator('input[name="username"]').fill(subject);
  await page.locator('input[type="submit"], button[type="submit"]').first().click();
}

export async function signInWithOidc(page: Page, subject: string) {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Continue with Authentik" }).click();
  await completeMockOidcLogin(page, subject);
  await expect(page).toHaveURL("/");
}

/** The token of a pending invitation created by `scripts/seed-e2e.ts`. */
export function invitationToken(invitation: keyof typeof INVITATIONS): string {
  return readFileSync(`${STATE_DIR}/${INVITATIONS[invitation].file}`, "utf8");
}
