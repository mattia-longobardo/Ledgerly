// tests/e2e/install.spec.ts — Ledgerly installs from the browser (rewrite plan, release N0).
// What a browser needs before it offers "Install" — a manifest it can fetch and parse, a name, a
// window of its own, a start page, icons of 192 and 512 px — checked on the real site, with the
// session a person has.
import { expect, test } from "@playwright/test";
import { sessionState } from "./env";

test.use({ storageState: sessionState("layout") });

test("a signed-in page names a manifest the browser accepts for installing", async ({ page }) => {
  await page.goto("/");
  const link = page.locator('head link[rel="manifest"]');
  await expect(link).toHaveAttribute("href", "/manifest.webmanifest");
  await expect(link).toHaveAttribute("crossorigin", "use-credentials");

  const response = await page.request.get("/manifest.webmanifest");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/manifest+json");
  const manifest = (await response.json()) as {
    name: string;
    display: string;
    start_url: string;
    icons: { src: string; sizes: string; purpose: string }[];
  };
  expect(manifest).toMatchObject({ name: "Ledgerly", display: "standalone", start_url: "/" });
  expect(manifest.icons.map((icon) => `${icon.sizes} ${icon.purpose}`)).toEqual([
    "192x192 any",
    "512x512 any",
    "512x512 maskable",
  ]);

  // Chrome's own reading of it: the manifest it found for this page, parsed without an error.
  // (`Page.getInstallabilityErrors` is not asked here: the headless shell this suite runs on answers
  // an empty list for any page, so it would prove nothing. Full Chrome answers it for real.)
  const client = await page.context().newCDPSession(page);
  const parsed = await client.send("Page.getAppManifest");
  expect(parsed.errors).toEqual([]);
  expect(parsed.url).toContain("/manifest.webmanifest");
});

test("the icons are served without a session, where an installer fetches them", async ({ page, browser }) => {
  const manifest = (await (await page.request.get("/manifest.webmanifest")).json()) as {
    icons: { src: string }[];
  };
  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  for (const icon of manifest.icons) {
    const response = await anonymous.request.get(icon.src);
    expect(response.status(), icon.src).toBe(200);
    expect(response.headers()["content-type"], icon.src).toBe("image/png");
  }
  // The manifest itself stays behind the session: without one the guard sends to sign-in.
  const guarded = await anonymous.request.get("/manifest.webmanifest", { maxRedirects: 0 });
  expect(guarded.status()).toBe(307);
  await anonymous.close();
});

test("the sign-in page names no manifest: nothing there could fetch it", async ({ browser }) => {
  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await anonymous.newPage();
  await page.goto("/sign-in");
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
  await anonymous.close();
});
