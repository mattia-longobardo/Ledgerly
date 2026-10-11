// tests/e2e/pockets.spec.ts — the Pockets journey at 1440 px (spec §7.4, §11).
import { expect, test } from "@playwright/test";
import { sessionState } from "./env";

// Its own user: two synced accounts and two pockets, one on the savings account and one standalone
// (scripts/seed-e2e.ts).
test.use({ storageState: sessionState("pockets") });

test("pockets are budgets that the expenses come off, each on its own page", async ({ page }) => {
  const detail = page.getByTestId("pocket-detail");
  const expenses = page.getByTestId("pocket-expenses");
  const planned = page.getByTestId("pocket-planned");

  await test.step("the list shows the seeded pockets and leads to a pocket's page", async () => {
    await page.goto("/pockets");
    await expect(page.getByRole("heading", { name: "Pockets", level: 1 })).toBeVisible();
    await expect(page.getByTestId("pocket-card")).toHaveCount(2);
    // 3.250 + 50 left; 10.000 − 3.250 free on the one account a pocket rests on.
    await expect(page.getByText("3.300,00 €").first()).toBeVisible();
    await expect(page.getByText("6.750,00 €").first()).toBeVisible();
    await page.getByTestId("pocket-card").filter({ hasText: "Holidays" }).click();
    await expect(page).toHaveURL(/\/pockets\/[0-9a-f-]{36}$/);
    await expect(detail).toContainText("Holidays · on Revolut Saving");
    // 250 accrued + 3.850 added − the account's 850 € expense.
    await expect(detail).toContainText("3.250,00 €");
    await expect(detail).toContainText("4.100,00 €");
    await expect(detail).toContainText(/ETA 3 months/);
    // After the planned 400 €.
    await expect(detail).toContainText("2.850,00 €");
    await expect(detail).toContainText("No interest rule on the account, or no positive balance.");
    await expect(expenses.getByRole("row").filter({ hasText: "Ischia — hotel + traghetto" })).toContainText(
      "−850,00 €",
    );
    await expect(planned).toContainText("Hotel Roma");
  });

  await test.step("adding to the budget shows what is free and what it becomes", async () => {
    await detail.getByRole("button", { name: "Add to pocket" }).click();
    const dialog = page.getByRole("dialog", { name: "Add to Holidays" });
    await dialog.getByLabel("Amount").fill("250");
    await expect(dialog).toContainText("Free on Revolut Saving: 6.500,00 €");
    await expect(dialog).toContainText("Pocket after: 3.500,00 €");
    await dialog.getByRole("button", { name: "Add to pocket" }).click();
    await expect(dialog).toBeHidden();
    await expect(detail).toContainText("3.500,00 €");
    await expect(detail).toContainText(/ETA 2 months/);
  });

  await test.step("a planned expense is added, then removed after asking", async () => {
    await detail.getByRole("button", { name: "Plan an expense" }).click();
    const dialog = page.getByRole("dialog", { name: "Plan an expense" });
    await dialog.getByLabel("What").fill("Train tickets");
    await dialog.getByLabel("Amount").fill("100");
    await dialog.getByRole("button", { name: "Add" }).click();
    await expect(dialog).toBeHidden();
    await expect(planned).toContainText("Train tickets");
    // 3.500 − 400 − 100.
    await expect(detail).toContainText("3.000,00 €");
    await planned.getByRole("button", { name: /Remove Train tickets/ }).click();
    const confirm = page.getByRole("dialog", { name: "Remove this planned expense?" });
    await confirm.getByRole("button", { name: "Remove" }).click();
    await expect(confirm).toBeHidden();
    await expect(planned).not.toContainText("Train tickets");
  });

  await test.step("an expense is linked to the standalone pocket, then unlinked", async () => {
    await page.goto("/pockets");
    await page.getByTestId("pocket-card").filter({ hasText: "Gifts" }).click();
    await expect(detail).toContainText("standalone envelope");
    await expect(detail).toContainText("Open-ended pocket");
    await detail.getByRole("button", { name: "Link an expense" }).click();
    const dialog = page.getByRole("dialog", { name: "Link an expense" });
    await expect(dialog.getByLabel("Expense")).toContainText("Libreria Feltrinelli");
    await dialog.getByRole("button", { name: "Link" }).click();
    await expect(dialog).toBeHidden();
    await expect(expenses.getByRole("row").filter({ hasText: "Libreria Feltrinelli" })).toContainText(
      "−30,00 €",
    );
    await expect(detail).toContainText("20,00 €");
    await expenses.getByRole("button", { name: /Unlink/ }).click();
    const confirm = page.getByRole("dialog", { name: "Unlink this expense?" });
    await confirm.getByRole("button", { name: "Unlink" }).click();
    await expect(confirm).toBeHidden();
    await expect(expenses).toContainText("No expense linked yet.");
  });

  await test.step("a new pocket is created on its own page, then edited", async () => {
    await page.goto("/pockets");
    await page.getByRole("button", { name: "+ New pocket" }).click();
    const dialog = page.getByRole("dialog", { name: "New pocket" });
    await dialog.getByLabel("Name").fill("New laptop");
    await dialog.getByLabel("Target (€) · optional").fill("2200");
    await dialog.getByLabel("Monthly accrual (€)").fill("200");
    await dialog.getByRole("button", { name: "Save pocket" }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/pockets\/[0-9a-f-]{36}$/);
    await expect(detail).toContainText("New laptop");
    // Starting this month, it accrues this month at once.
    await expect(detail).toContainText("200,00 €");

    await detail.getByRole("button", { name: "Edit pocket" }).click();
    const edit = page.getByRole("dialog", { name: "Edit pocket" });
    await edit.getByLabel("Name").fill("Laptop");
    await edit.getByRole("button", { name: "Save pocket" }).click();
    await expect(edit).toBeHidden();
    await page.goto("/pockets");
    await expect(page.getByTestId("pocket-card").filter({ hasText: "Laptop" })).toHaveCount(1);
  });

  await test.step("the ⌘K palette opens a pocket's page by name (spec §8.2)", async () => {
    await page.getByRole("button", { name: /Search or jump to/ }).click();
    await page.getByRole("combobox", { name: /Search or jump to/ }).fill("holi");
    await page.getByRole("option", { name: /Holidays/ }).click();
    await expect(detail).toContainText("Holidays · on Revolut Saving");
  });

  await test.step("Overview shows the pockets as its fourth figure", async () => {
    await page.goto("/");
    // 3.500 + 50 + 200 left, 250 + 50 + 200 a month.
    await expect(page.getByText("3.750,00 €").first()).toBeVisible();
    await expect(page.getByText("+500 € · per month")).toBeVisible();
    await expect(page.getByText("3 pockets")).toBeVisible();
  });
});
