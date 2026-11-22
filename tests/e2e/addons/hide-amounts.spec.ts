// tests/e2e/addons/hide-amounts.spec.ts — «Hide amounts» (R5e, D3): the switch of the Profile hides
// every amount of every main screen, and the figures come back unchanged once it is off.
import { expect, type Page, test } from "@playwright/test";
import { sessionState } from "../_shared/env";
import { hydrated } from "../_shared/helpers";

// Its own copy of the `layout` user: something on every page, and a choice nobody else sees.
test.use({ storageState: sessionState("hidden") });

const MASK = "•••••";
/** An amount as the formats write it: a currency sign beside digits, either side, with any separators. */
const AMOUNT = /(€|\$|£|CHF|USD)\s?[−-]?\d|\d[\d.,\s]*\s?(€|\$|£|CHF|USD)/;

const SCREENS = [
  "/",
  "/accounts",
  "/expenses",
  "/budgets",
  "/subscriptions",
  "/investments",
  "/funds",
  "/pockets",
  "/interests",
  "/payroll",
] as const;

/** The page's text once its reads answered: the skeletons gone and the loading lines too. */
async function textOf(page: Page, path: string): Promise<string> {
  await page.goto(path);
  // Each block of a page reads on its own: the text is read once every read answered.
  await page.waitForLoadState("networkidle");
  await page.locator("main").first().waitFor();
  await expect(page.locator("main .animate-shimmer")).toHaveCount(0);
  await expect(page.locator("main [role=status]", { hasText: /^Loading/ })).toHaveCount(0);
  return page.locator("main").first().innerText();
}

async function setHidden(page: Page, hidden: boolean) {
  await page.goto("/settings/profile");
  const control = page.getByRole("switch", { name: "Hide amounts" });
  await hydrated(control);
  if ((await control.getAttribute("aria-checked")) !== String(hidden)) await control.click();
  await expect(control).toHaveAttribute("aria-checked", String(hidden));
}

test("every main screen hides its amounts, and shows the same figures once it is off", async ({ page }) => {
  test.setTimeout(180_000);
  expect(await textOf(page, "/")).toMatch(AMOUNT);
  const before = await page.locator("main p.text-hero").innerText();

  await setHidden(page, true);
  try {
    for (const path of SCREENS) {
      const text = await textOf(page, path);
      expect(text, path).not.toMatch(AMOUNT);
    }
    expect(await textOf(page, "/")).toContain(MASK);
    // An account's own page, with its chart and its transactions.
    await page.goto("/accounts");
    await page.locator("main a[href^='/accounts/']").first().click();
    await expect(page).toHaveURL(/\/accounts\/[0-9a-f-]{36}/);
    expect(await page.locator("main").innerText()).not.toMatch(AMOUNT);
  } finally {
    await setHidden(page, false);
  }
  expect(await textOf(page, "/")).toMatch(AMOUNT);
  // The net worth reads as it did before: the mask changed the text only.
  expect(await page.locator("main p.text-hero").innerText()).toEqual(before);
});
