// tests/e2e/legal.spec.ts — the two public documents of the instance, `/privacy` and `/terms`.
// A service that registers the instance reads them without an account: every test here is
// anonymous, and the last one checks that nothing else became public with them.
import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

const DOCUMENTS = [
  {
    path: "/privacy",
    en: "Privacy",
    it: "Privacy",
    enSection: "Where the data is",
    itSection: "Dove stanno i dati",
  },
  {
    path: "/terms",
    en: "Terms",
    it: "Termini",
    enSection: "Not financial advice",
    itSection: "Nessuna consulenza finanziaria",
  },
] as const;

for (const document of DOCUMENTS) {
  test(`${document.path} answers without a session, in English and in Italian`, async ({ page }) => {
    const english = await page.goto(`${document.path}?lang=en`);
    expect(english?.status()).toBe(200);
    await expect(page).toHaveURL(new RegExp(`${document.path}\\?lang=en$`));
    await expect(page.getByRole("heading", { level: 1, name: document.en })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: document.enSection })).toBeVisible();
    await expect(page).toHaveTitle(`${document.en} · Ledgerly`);

    const italian = await page.goto(`${document.path}?lang=it`);
    expect(italian?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: document.it })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: document.itSection })).toBeVisible();
    await expect(page.locator("article")).toHaveAttribute("lang", "it");
  });
}

test("the documents link to each other, to the other language and to sign-in", async ({ page }) => {
  await page.goto("/privacy?lang=en");
  const nav = page.getByRole("navigation", { name: "Legal pages" });
  await nav.getByRole("link", { name: "Italiano" }).click();
  await expect(page).toHaveURL(/\/privacy\?lang=it$/);
  await page
    .getByRole("navigation", { name: "Pagine legali" })
    .getByRole("link", { name: "Termini" })
    .click();
  await expect(page).toHaveURL(/\/terms\?lang=it$/);
  await expect(page.getByRole("heading", { level: 1, name: "Termini" })).toBeVisible();
  await page.getByRole("navigation", { name: "Pagine legali" }).getByRole("link", { name: "Accedi" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("the sign-in pages link to both documents", async ({ page }) => {
  for (const path of ["/sign-in", "/forgot-password"]) {
    await page.goto(path);
    const nav = page.getByRole("navigation", { name: "Legal pages" });
    await expect(nav.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    await expect(nav.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
  }
  await page.goto("/sign-in");
  await page.getByRole("link", { name: "Privacy" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole("heading", { level: 1, name: "Privacy" })).toBeVisible();
});

test("nothing else became public: the app's pages still send an anonymous visitor to sign-in", async ({
  request,
}) => {
  for (const path of [
    "/",
    "/accounts",
    "/expenses",
    "/settings/profile",
    "/settings/privacy",
    "/termsheet",
  ]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(307);
    expect(new URL(response.headers().location, "http://x").pathname, path).toBe("/sign-in");
  }
  expect((await request.get("/api/v1/accounts", { maxRedirects: 0 })).status()).toBe(401);
});
