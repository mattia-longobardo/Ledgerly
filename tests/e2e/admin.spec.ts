// tests/e2e/admin.spec.ts — Admin › Users and Admin › Server (F8) on the deployed site.
//
// This page lists the instance's **real** users beside the seeded ones. Every action here is
// addressed to a row found by an `@example.test` address, and the only user whose role, block and
// removal are exercised is `disposable@example.test`, which exists for this spec and nothing else.
// Admin › Server is read only here on purpose: saving SMTP or the identity provider would
// reconfigure the live instance, and a spec that half-succeeds would leave it reconfigured.
import { expect, test } from "@playwright/test";
import { sessionState, USERS } from "./env";

test.use({ storageState: sessionState("admin") });

const DISPOSABLE = USERS.disposable.email;

test.describe.configure({ mode: "serial" });

test("an admin invites someone and withdraws the invitation", async ({ page }) => {
  const invited = `invited-${Date.now()}@example.test`;
  await page.goto("/settings/users");
  await expect(page.getByRole("heading", { name: "Users", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Invite user" }).click();
  await page.getByLabel("Email").fill(invited);
  await page.getByRole("button", { name: "Send invitation" }).click();

  const row = page.getByRole("row").filter({ hasText: invited });
  await expect(row).toBeVisible();
  await expect(row.getByText("Pending")).toBeVisible();

  await row.getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByRole("row").filter({ hasText: invited })).toHaveCount(0);
});

test("an admin changes a role, blocks, unblocks and finally removes a user", async ({ page }) => {
  await page.goto("/settings/users");
  const row = page.getByRole("row").filter({ hasText: DISPOSABLE });
  await expect(row).toBeVisible();

  const role = row.getByRole("combobox");
  await role.selectOption("admin");
  await page.reload();
  await expect(page.getByRole("row").filter({ hasText: DISPOSABLE }).getByRole("combobox")).toHaveValue(
    "admin",
  );
  await page.getByRole("row").filter({ hasText: DISPOSABLE }).getByRole("combobox").selectOption("user");
  await page.reload();

  const again = page.getByRole("row").filter({ hasText: DISPOSABLE });
  await again.getByRole("button", { name: "Block", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: DISPOSABLE }).getByText("Blocked")).toBeVisible();
  await page
    .getByRole("row")
    .filter({ hasText: DISPOSABLE })
    .getByRole("button", { name: "Unblock" })
    .click();
  await expect(page.getByRole("row").filter({ hasText: DISPOSABLE }).getByText("Active")).toBeVisible();

  await page.getByRole("row").filter({ hasText: DISPOSABLE }).getByRole("button", { name: "Remove" }).click();
  // A toast is a `dialog` too: name the one that was opened.
  const dialog = page.getByRole("dialog", { name: "Remove this user?" });
  await expect(dialog).toContainText(DISPOSABLE);
  await dialog.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("row").filter({ hasText: DISPOSABLE })).toHaveCount(0);
});

test("an admin's own row offers no way to lock themselves out", async ({ page }) => {
  await page.goto("/settings/users");
  const mine = page.getByRole("row").filter({ hasText: USERS.admin.email });
  await expect(mine).toBeVisible();
  await expect(mine.getByRole("button", { name: "Reset password" })).toBeVisible();
  await expect(mine.getByRole("button", { name: "Block", exact: true })).toHaveCount(0);
  await expect(mine.getByRole("button", { name: "Remove" })).toHaveCount(0);
});

test("Admin › Server shows the identity provider, outgoing mail and maintenance", async ({ page }) => {
  await page.goto("/settings/server");
  await expect(page.getByRole("heading", { name: "Authentik (OIDC)" })).toBeVisible();
  await expect(page.getByLabel("Issuer URL")).toHaveValue(/^https?:\/\//);
  await expect(page.getByRole("heading", { name: "Outgoing email (SMTP)" })).toBeVisible();
  for (const label of ["Invitations & resets", "Sync failures", "Monthly summary"]) {
    await expect(page.getByLabel(label)).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "Maintenance" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Back up now" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export all data" })).toBeVisible();
});

test("an admin can see every scheduled job and run one by hand", async ({ page }) => {
  await page.goto("/settings/integrations");
  await expect(page.getByRole("heading", { name: "Scheduled jobs" })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "housekeeping" });
  await expect(row).toBeVisible();
  await expect(row.getByRole("button", { name: "Run now" })).toBeEnabled();
});
