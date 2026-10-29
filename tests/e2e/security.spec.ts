// tests/e2e/security.spec.ts — the Client API (docs/auth-design.md D3) and "Export my data" (F8), as
// an ordinary user on the deployed site. The client is created, its token spent against /api/v1,
// the client deleted, and the token proved dead.
import { expect, request as http, test } from "@playwright/test";
import { BASE_URL, sessionState } from "./env";

test.use({ storageState: sessionState("tokens") });

test.describe.configure({ mode: "serial" });

test("a Client API is shown once, gets a token, works on /api/v1 and stops the moment it is deleted", async ({
  page,
}) => {
  await page.goto("/settings/security");
  await expect(page.getByRole("heading", { name: "Client API" })).toBeVisible();

  await page.getByRole("button", { name: "New client" }).click();
  await page.getByLabel("Name").fill("e2e");
  await page.getByRole("button", { name: "Create client" }).click();

  const read = async (key: string) => ((await page.getByTestId(`minted-${key}`).textContent()) ?? "").trim();
  await expect(page.getByTestId("minted-clientSecret")).toBeVisible();
  const [clientId, clientSecret, tokenEndpoint, resource] = await Promise.all(
    ["clientId", "clientSecret", "tokenEndpoint", "resource"].map(read),
  );
  await expect(page.getByText("Copy the secret now: this is the only time it is shown")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();

  // What is left on screen is the client id, never the secret.
  const row = page.getByRole("row").filter({ hasText: "e2e" });
  await expect(row).toContainText(clientId);
  await expect(row).not.toContainText(clientSecret);

  // A script, not the browser: no session cookie, so no CSRF origin check on the token endpoint.
  const script = await http.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
  const minted = await script.post(tokenEndpoint, {
    headers: { authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}` },
    form: { grant_type: "client_credentials", resource },
  });
  expect(minted.status()).toBe(200);
  const { access_token: token } = (await minted.json()) as { access_token: string };

  const headers = { authorization: `Bearer ${token}` };
  const summary = await script.get("/api/v1/summary", { headers });
  expect(summary.status()).toBe(200);
  expect(await summary.json()).toMatchObject({ month: expect.any(String) });

  // No administrative surface exists under /api/v1, whoever the token belongs to.
  expect((await script.get("/api/v1/users", { headers })).status()).toBe(404);
  // The scope is the second gate: a read-only client cannot upload.
  const upload = await script.post("/api/v1/imports", { headers, multipart: { kind: "payslip" } });
  expect(upload.status()).toBe(403);
  expect(upload.headers()["www-authenticate"]).toContain('error="insufficient_scope"');

  await page.getByRole("row").filter({ hasText: "e2e" }).getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  // Wait for the answer, not for the row: while the dialog is open the table behind it is hidden
  // from the accessibility tree, so "no row" would hold before anything was deleted.
  await expect(page.getByText("e2e deleted")).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "e2e" })).toHaveCount(0);
  expect((await script.get("/api/v1/summary", { headers })).status()).toBe(401);
  await script.dispose();
});

test("/api/v1 refuses a call with no token at all, and says where to get one", async ({ request }) => {
  const response = await request.get("/api/v1/summary");
  expect(response.status()).toBe(401);
  expect(response.headers()["www-authenticate"]).toMatch(
    /^Bearer resource_metadata=".*\/\.well-known\/oauth-protected-resource\/api\/v1"$/,
  );
  const metadata = await request.get("/.well-known/oauth-protected-resource/api/v1");
  expect(metadata.status()).toBe(200);
  expect(await metadata.json()).toMatchObject({
    scopes_supported: ["read", "write", "imports", "investments:read"],
  });
  const server = await request.get("/.well-known/oauth-authorization-server/api/auth");
  expect(server.status()).toBe(200);
  expect(await server.json()).toMatchObject({
    grant_types_supported: expect.arrayContaining(["client_credentials"]),
  });
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
