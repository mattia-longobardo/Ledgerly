// tests/e2e/addons/welcome.spec.ts — the first start (R5a, E4, PA13, D3): a person who signed up has
// every addon off and opens the first start from any page; a country without a pack proposes the
// browser's values and none of Italy's; once it ends, only the addons chosen are on.
import { expect, type Page, test } from "@playwright/test";
import { sessionState } from "../_shared/env";
import { hydrated } from "../_shared/helpers";

// Its own user, as a sign-up leaves it (scripts/seed-e2e.ts), and a browser that is not Italian.
test.use({ storageState: sessionState("welcomeJourney"), locale: "en-US", timezoneId: "America/New_York" });

async function activeAddons(page: Page): Promise<string[]> {
  const answer = await page.request.get("/api/v1/addons");
  expect(answer.ok()).toBe(true);
  const { addons } = (await answer.json()) as { addons: { id: string; active: boolean }[] };
  return addons.filter((one) => one.active).map((one) => one.id);
}

test("the first start opens from every page, and turns on only the addons chosen", async ({ page }) => {
  expect(await activeAddons(page)).toEqual([]);

  for (const path of ["/", "/accounts", "/settings/profile"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/welcome$/);
  }
  await expect(page.getByRole("heading", { level: 1, name: "Country and format" })).toBeVisible();

  // The browser proposes: the United States, its dollar, its zone, its format and English.
  const country = page.getByLabel("Country", { exact: true });
  await hydrated(country);
  await expect(country).toHaveValue("US");
  await expect(page.getByLabel("Display currency")).toHaveValue("USD");
  await expect(page.getByLabel("Timezone")).toHaveValue("America/New_York");
  await expect(page.getByLabel("Number format")).toHaveValue("en-US");
  await expect(page.getByLabel("Language")).toHaveValue("en");

  // Italy has a pack: it proposes its own values.
  await country.selectOption("IT");
  await expect(page.getByLabel("Display currency")).toHaveValue("EUR");
  await expect(page.getByLabel("Timezone")).toHaveValue("Europe/Rome");
  await expect(page.getByLabel("Number format")).toHaveValue("it-IT");

  // Germany has none: the browser's values come back, and none of Italy's stays (D3).
  await country.selectOption("DE");
  await expect(page.getByLabel("Display currency")).toHaveValue("USD");
  await expect(page.getByLabel("Timezone")).toHaveValue("America/New_York");
  await expect(page.getByLabel("Number format")).toHaveValue("en-US");
  await expect(page.getByLabel("Language")).toHaveValue("en");
  await page.getByRole("button", { name: "Continue" }).click();

  // No addon is ticked before the person ticks it.
  await expect(page.getByRole("heading", { level: 1, name: "Addons" })).toBeVisible();
  for (const box of await page.getByRole("checkbox").all()) await expect(box).not.toBeChecked();
  await page.getByRole("checkbox", { name: "Budgets" }).check();
  await page.getByRole("checkbox", { name: "Pockets" }).check();
  await page.getByRole("button", { name: "Continue" }).click();

  // The first account, with its IBAN field; the person may also skip it.
  await expect(page.getByRole("heading", { level: 1, name: "Your first account" })).toBeVisible();
  await expect(page.getByLabel("IBAN (optional)")).toBeVisible();
  await expect(page.getByRole("button", { name: "Skip" })).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("Everyday");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/$/);

  expect((await activeAddons(page)).sort()).toEqual(["budgets", "pockets"]);
  const onboarding = await page.request.get("/api/v1/onboarding");
  expect(await onboarding.json()).toMatchObject({ pending: false, country: "DE" });
  const preferences = await (await page.request.get("/api/v1/preferences")).json();
  expect(preferences).toMatchObject({
    displayCurrency: "USD",
    timeZone: "America/New_York",
    numberFormat: "en-US",
    locale: "en",
  });

  // The first start is behind the person: its page now leads to the app.
  await page.goto("/welcome");
  await expect(page).toHaveURL(/\/$/);
});
