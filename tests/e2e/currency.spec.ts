// tests/e2e/currency.spec.ts — the display currency (docs/design/investments.md §1.8, phase 1b).
import { expect, test } from "@playwright/test";
import { sessionState } from "./env";

// The seed gives this user an account in EUR and one in USD (scripts/seed-e2e.ts, `seedCurrency`).
test.use({ storageState: sessionState("currency") });

test("the totals follow the display currency chosen in Settings, each account keeps its own", async ({
  page,
}) => {
  const hero = page.locator(".text-hero");

  await test.step("by default every total is in EUR and the USD account shows its value in EUR too", async () => {
    await page.goto("/");
    await expect(hero).toContainText("€");
    const usd = page.getByRole("row").filter({ hasText: "Broker USD" });
    await expect(usd).toContainText("1.000,00 USD");
    await expect(usd).toContainText("≈");
    await expect(usd).toContainText("€");
  });

  await test.step("the field is reached with the keyboard, and saving switches to USD", async () => {
    await page.goto("/settings/profile");
    await page.getByLabel("Currency sign").focus();
    await page.keyboard.press("Tab");
    const field = page.getByLabel("Display currency");
    await expect(field).toBeFocused();
    await expect(field).toHaveValue("EUR");
    await field.selectOption("USD");
    await page.locator("form", { has: field }).getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Preferences saved")).toBeVisible();
  });

  await test.step("Overview totals are in USD; the EUR account stays in EUR with its USD line", async () => {
    await page.goto("/");
    await expect(hero).toContainText("USD");
    await expect(hero).not.toContainText("€");
    const eur = page.getByRole("row").filter({ hasText: "Conto EUR" });
    await expect(eur).toContainText("1.000,00 €");
    await expect(eur).toContainText("≈");
    await expect(eur).toContainText("USD");
    // The USD account is in the display currency now: nothing to say twice.
    await expect(page.getByRole("row").filter({ hasText: "Broker USD" })).not.toContainText("≈");
  });

  await test.step("Accounts totals are in USD too", async () => {
    await page.goto("/accounts");
    await expect(page.getByTestId("accounts-summary")).toContainText("USD");
    await expect(page.getByRole("row").filter({ hasText: "Total" })).toContainText("USD");
  });

  await test.step("back to EUR, every total is in EUR again", async () => {
    await page.goto("/settings/profile");
    const field = page.getByLabel("Display currency");
    await field.selectOption("EUR");
    await page.locator("form", { has: field }).getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Preferences saved")).toBeVisible();
    await page.goto("/");
    await expect(hero).toContainText("€");
  });
});
