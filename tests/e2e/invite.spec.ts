// tests/e2e/invite.spec.ts
import { expect, test } from "@playwright/test";
import { INVITATIONS } from "./env";
import { completeMockOidcLogin, invitationToken, pageAlert } from "./helpers";

const INVALID = "This invitation is invalid, expired or already used.";

test("an invitation creates the account and signs the invitee in", async ({ page }) => {
  const token = invitationToken("password");
  const response = await page.goto(`/invite/${token}`);
  // The token is in this page's URL: it must never travel on as a Referer.
  expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
  await expect(page.getByText(`Invited as ${INVITATIONS.password.email}.`)).toBeVisible();
  await page.getByLabel("Full name").fill("Invitee Person");
  await page.getByLabel("Password", { exact: true }).fill("invitee-password-1");
  await page.getByLabel("Confirm new password").fill("invitee-password-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL("/");
  await page.goto(`/invite/${token}`);
  await expect(pageAlert(page)).toHaveText(INVALID);
});

// One Authentik sign-in for both steps: the suite's Authentik starts stay within Better Auth's
// per-client limit on /sign-in/* (3 per 10 s), see tests/e2e/env.ts.
test("Authentik completes an invitation for the invited address only", async ({ page }) => {
  await test.step("the invited address gets the invitation's role and uses it up", async () => {
    const token = invitationToken("sso");
    await page.goto(`/invite/${token}`);
    await expect(page.getByText(`Invited as ${INVITATIONS.sso.email}.`)).toBeVisible();
    await page.getByRole("button", { name: "Use Authentik instead" }).click();
    // The mock provider gives this address no admin group: the admin role comes from the invitation.
    await completeMockOidcLogin(page, INVITATIONS.sso.email);
    await expect(page).toHaveURL("/");
    await expect(
      page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Components" }),
    ).toBeVisible();
    await page.goto("/components");
    await expect(page.getByRole("heading", { name: "Colour tokens" })).toBeVisible();
    await page.goto(`/invite/${token}`);
    await expect(pageAlert(page)).toHaveText(INVALID);
  });

  await test.step("an invitation for another address is refused and stays pending", async () => {
    // Where Authentik returns after a sign-in started from that invitation's page.
    const token = invitationToken("ssoMismatch");
    await page.goto(`/invite/${token}/complete`);
    await expect(page).toHaveURL(`/invite/${token}?error=email_mismatch`);
    await expect(pageAlert(page)).toHaveText(
      "This invitation is for a different email address than your Authentik account.",
    );
    await expect(page.getByText(`Invited as ${INVITATIONS.ssoMismatch.email}.`)).toBeVisible();
  });
});
