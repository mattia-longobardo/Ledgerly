// tests/e2e/budgets.spec.ts — the F3 Budgets journey at 1440 px (spec §7.3, §11).
import { expect, type Page, test } from "@playwright/test";
import { sessionState } from "./env";

// Its own user, seeded with this month's spending and three limits (scripts/seed-e2e.ts).
test.use({ storageState: sessionState("budgets") });

const row = (page: Page, name: string) => page.getByTestId("budget-row").filter({ hasText: name });

test("limits per category show their progress and can be edited, removed and added", async ({ page }) => {
  await test.step("the month opens with the three budgets and their states", async () => {
    await page.goto("/budgets");
    await expect(page.getByRole("heading", { name: "Budgets", level: 1 })).toBeVisible();
    await expect(page.getByTestId("budget-row")).toHaveCount(3);
    await expect(row(page, "Spesa")).toContainText("On track");
    await expect(row(page, "Spesa")).toContainText(/46\s%/);
    await expect(row(page, "Ristoranti")).toContainText("Near limit");
    // The giroconto filed under Trasporti is not spending (spec §7.2): 21,00 €, not 321,00 €.
    await expect(row(page, "Trasporti")).toContainText("21,00 €");
    await expect(row(page, "Trasporti")).toContainText("Over");
    await expect(row(page, "Trasporti")).toContainText("−1,00 €");
    // 45,50 + 48,00 + 21,00 of 100 + 50 + 20; Netflix has no budget.
    await expect(page.getByText(/^114,50\s€ of 170\s€ · 67\s%$/)).toBeVisible();
    await expect(page.getByText(/^Not budgeted this month: 12,99\s€$/)).toBeVisible();
  });

  await test.step("a limit edited in place changes the state", async () => {
    await row(page, "Trasporti")
      .getByRole("button", { name: /Edit limit/ })
      .click();
    const input = page.getByRole("textbox", { name: "Monthly limit for Trasporti" });
    await input.fill("30");
    await input.press("Enter");
    await expect(row(page, "Trasporti")).toContainText("On track");
    await expect(row(page, "Trasporti")).toContainText("9,00 €");
  });

  await test.step("Esc puts the old limit back", async () => {
    await row(page, "Spesa")
      .getByRole("button", { name: /Edit limit/ })
      .click();
    const input = page.getByRole("textbox", { name: "Monthly limit for Spesa" });
    await input.fill("1");
    await input.press("Escape");
    await expect(row(page, "Spesa")).toContainText("On track");
  });

  await test.step("a budget removed from this month leaves the table", async () => {
    await row(page, "Ristoranti").getByRole("button", { name: "Budget actions" }).click();
    await page.getByRole("menuitem", { name: "Remove from this month" }).click();
    await expect(page.getByTestId("budget-row")).toHaveCount(2);
  });

  await test.step("a budget is added from the dialog", async () => {
    await page.getByRole("button", { name: "Add budget" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Add budget" });
    await dialog.getByRole("button", { name: "Category" }).click();
    await page.getByRole("combobox", { name: "Search categories" }).fill("abbo");
    await page.getByRole("option", { name: "Abbonamenti" }).click();
    await dialog.getByLabel("Monthly limit (€)").fill("15");
    await dialog.getByRole("button", { name: "Add budget" }).click();
    await expect(dialog).toBeHidden();
    await expect(row(page, "Abbonamenti")).toContainText("Near limit");
  });

  await test.step("a budget can be on an account, whatever the category (F3)", async () => {
    await page.getByRole("button", { name: "Add budget" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Add budget" });
    await dialog.getByLabel("Account").selectOption({ label: "ING Conto Arancio" });
    await dialog.getByLabel("Monthly limit (€)").fill("200");
    await dialog.getByRole("button", { name: "Add budget" }).click();
    await expect(dialog).toBeHidden();
    // Every expense on the account: 45,50 + 48,00 + 21,00 + 12,99; the giroconto is not spending.
    const whole = row(page, "All categories");
    await expect(whole).toContainText("ING Conto Arancio");
    await expect(whole).toContainText("127,49 €");
  });

  await test.step("the month stepper goes back to a month before any limit", async () => {
    await page.getByRole("link", { name: "Previous month" }).click();
    await expect(page).toHaveURL(/off=1/);
    await expect(page.getByRole("heading", { name: "No budgets set" })).toBeVisible();
    await page.getByRole("link", { name: "This month" }).click();
    // Spesa, Trasporti, Abbonamenti and the whole ING account.
    await expect(page.getByTestId("budget-row")).toHaveCount(4);
  });

  await test.step("Overview shows the budgets closest to their limit", async () => {
    await page.goto("/");
    const card = page.getByTestId("budgets-card");
    await expect(card).toContainText("Abbonamenti");
    await expect(card).toContainText("2,01 € left");
  });
});
