import { expect, test } from "@playwright/test";

test("health answers, the API is gated, and the app redirects to sign-in", async ({ request, page }) => {
  expect((await request.get("/api/health")).ok()).toBeTruthy();
  expect((await request.get("/api/v1/openapi.json")).status()).toBe(401);
  await page.goto("/");
  await expect(page).toHaveURL(/\/signin/);
});
