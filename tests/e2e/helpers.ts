// tests/e2e/helpers.ts
import { expect, type Locator, type Page } from "@playwright/test";
import { PREVIEW_CLIENT_PREFIX } from "./env";
import { totpCode, totpSecretFor } from "./totp";

/**
 * Today as the test users see it, `YYYY-MM-DD`: in their time zone, which is the seed's
 * (scripts/seed-e2e.ts, `Europe/Rome`), not the machine's. A spec that names a day or a year starts
 * from here and from no date written by hand: a date written by hand is right until a year ends.
 */
export const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(new Date());
export const THIS_YEAR = Number(TODAY.slice(0, 4));
export const LAST_YEAR = THIS_YEAR - 1;

/**
 * The address a spec file's requests come from, on the local preview only. The site allows one
 * client 5 password sign-ins a minute, and the preview sees every worker as the same client: with
 * `test.use({ extraHTTPHeaders: previewClient(n) })` each file that signs in with a password is a
 * client of its own, so the files run side by side. On the site nothing is sent: the proxy sets
 * the address there.
 */
export function previewClient(n: number): Record<string, string> {
  return process.env.E2E_BASE_URL ? { "x-forwarded-for": `${PREVIEW_CLIENT_PREFIX}${n}` } : {};
}

/** The page's own alert message. Next.js also renders an empty `role="alert"` route announcer. */
export function pageAlert(page: Page): Locator {
  return page.getByRole("alert").filter({ hasText: /\S/ });
}

/** The password, then the TOTP code the seed's secret gives (every test user but two has TOTP). */
export async function signInWithPassword(page: Page, email: string, password: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL("/sign-in/two-factor");
  await page.getByLabel("Authentication code").fill(await totpCode(totpSecretFor(email)));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL("/");
}

/**
 * React has taken the element over, and its handlers answer. The server draws a control before the
 * browser makes it work: a key or a click in between does nothing, and the test would blame the
 * control. React writes its properties on an element when it takes it over, so their presence is
 * the condition — no fixed wait says it.
 */
export async function hydrated(target: Locator): Promise<void> {
  await expect
    .poll(
      () => target.evaluate((element) => Object.keys(element).some((key) => key.startsWith("__reactProps$"))),
      { message: "the control never started to answer" },
    )
    .toBe(true);
}
