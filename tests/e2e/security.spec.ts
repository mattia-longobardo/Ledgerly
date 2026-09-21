// tests/e2e/security.spec.ts — personal access tokens and "Export my data" (F8), as an ordinary
// user on the deployed site. The token is minted, spent against /api/v1, revoked, and proved dead.
import { expect, test } from "@playwright/test";
import { sessionState } from "./env";

test.use({ storageState: sessionState("tokens") });

test.describe.configure({ mode: "serial" });

test("a token is shown once, works on /api/v1 and stops the moment it is revoked", async ({
  page,
  request,
}) => {
  await page.goto("/settings/security");
  await expect(page.getByRole("heading", { name: "Access tokens" })).toBeVisible();

  await page.getByRole("button", { name: "New token" }).click();
  await page.getByLabel("Name").fill("e2e");
  await page.getByRole("button", { name: "Create token" }).click();

  const shown = page.getByTestId("minted-token");
  await expect(shown).toBeVisible();
  const token = ((await shown.textContent()) ?? "").trim();
  expect(token).toMatch(/^pat_[a-z0-9]{8}\.[A-Za-z0-9_-]{43}$/);
  await expect(page.getByText("Copy it now: this is the only time it is shown")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();

  // What is left on screen is the prefix and nothing more.
  const row = page.getByRole("row").filter({ hasText: "e2e" });
  await expect(row).toContainText(token.slice(0, 12));
  await expect(row).not.toContainText(token);
  await expect(row.getByText("Active")).toBeVisible();

  const headers = { authorization: `Bearer ${token}` };
  const summary = await request.get("/api/v1/summary", { headers });
  expect(summary.status()).toBe(200);
  expect(await summary.json()).toMatchObject({ month: expect.any(String) });

  // No administrative surface exists under /api/v1, whoever the token belongs to.
  expect((await request.get("/api/v1/users", { headers })).status()).toBe(404);

  await page.getByRole("row").filter({ hasText: "e2e" }).getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByRole("row").filter({ hasText: "e2e" }).getByText("Revoked")).toBeVisible();
  expect((await request.get("/api/v1/summary", { headers })).status()).toBe(401);
});

test("/api/v1 refuses a call with no token at all", async ({ request }) => {
  expect((await request.get("/api/v1/summary")).status()).toBe(401);
});

test("a user downloads everything they own as one ZIP", async ({ page }) => {
  await page.goto("/settings/data");
  const link = page.getByRole("link", { name: "Export my data" });
  await expect(link).toBeVisible();
  const download = page.waitForEvent("download");
  await link.click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^ledgerly-\d{4}-\d{2}-\d{2}\.zip$/);
});
