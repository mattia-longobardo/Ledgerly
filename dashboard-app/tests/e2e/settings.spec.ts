import { expect, test } from "@playwright/test";

test("the Settings areas and the webhook endpoint are gated", async ({ page, request }) => {
  for (const path of ["/settings", "/settings/personal", "/settings/security", "/settings/integrations"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/signin/);
  }
  // Signed out, the API refuses; the webhook is public but unsigned, so 404.
  expect((await request.get("/api/v1/integrations")).status()).toBe(401);
  expect((await request.post("/api/v1/webhooks/wallet", { data: { event: "x" } })).status()).toBe(404);
});
