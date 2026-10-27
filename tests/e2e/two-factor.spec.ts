// tests/e2e/two-factor.spec.ts — TOTP for password accounts (docs/auth-design.md D2) on the
// deployed site, which runs with TWO_FACTOR_POLICY=required: the forced setup, the sign-in
// challenge and its error. Signed-in users only start from seeded sessions, so the run's
// rate-limited password sign-ins are spent here once.
import { expect, test } from "@playwright/test";
import { USERS, sessionState } from "./env";
import { pageAlert } from "./helpers";
import { totpCode, totpSecretFor } from "./totp";

test.describe("a password account without TOTP", () => {
  test.use({ storageState: sessionState("enroll") });

  test("is held at the setup until a code confirms it, then reaches the app", async ({ page }) => {
    await page.goto("/settings/profile");
    await expect(page).toHaveURL("/sign-in/two-factor/setup");
    await expect(page.getByRole("heading", { name: "Set up two-factor authentication" })).toBeVisible();

    await page.getByLabel("Password").fill(USERS.enroll.password);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("img", { name: "QR code for the authenticator app" })).toBeVisible();
    await expect(page.getByTestId("recovery-codes").getByRole("listitem")).toHaveCount(10);
    const secret = (await page.getByTestId("totp-secret").textContent()) ?? "";

    await page.getByLabel("3. Code from the app").fill(await totpCode(secret));
    await page.getByLabel("I have saved my recovery codes").check();
    await page.getByRole("button", { name: "Turn on two-factor authentication" }).click();
    await expect(page).toHaveURL("/");

    await page.goto("/settings/security");
    const card = page.getByRole("region", { name: "Two-factor authentication" });
    await expect(card.getByText("On", { exact: true })).toBeVisible();
    await expect(card.getByRole("button", { name: "New recovery codes" })).toBeVisible();
  });
});

test.describe("a password account with TOTP", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("gets no session from the password alone, and a wrong code is refused", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(USERS.prefs.email);
    await page.getByLabel("Password").fill(USERS.prefs.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL("/sign-in/two-factor");

    // The password alone opened nothing.
    await page.goto("/settings/profile");
    await expect(page).toHaveURL(/\/sign-in$/);
    await page.goto("/sign-in/two-factor");

    const right = await totpCode(totpSecretFor(USERS.prefs.email));
    const wrong = right
      .split("")
      .map((digit) => String((Number(digit) + 5) % 10))
      .join("");
    await page.getByLabel("Authentication code").fill(wrong);
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(pageAlert(page)).toHaveText("That code is not right. Try the current one.");

    await page.getByLabel("Authentication code").fill(right);
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page).toHaveURL("/");
  });
});
