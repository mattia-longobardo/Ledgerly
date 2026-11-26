// tests/e2e/transactions/edit-dialog.spec.ts — the edit dialog of a movement (owner, 2026-11-26: the
// concept of Wallet's «Edit», no «⋯» menu on the row): one test for each state, on the `editing`
// user, whose movements are all last month (scripts/seed-e2e/transactions.ts, `seedEditing`).
// Each test changes a movement of its own, so they run in any order.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { sessionState } from "../_shared/env";

test.use({ storageState: sessionState("editing") });

const LAST_MONTH = "/expenses?off=1";

/** The table's row of a payee (the phone's list is hidden at 1440 px). */
const row = (page: Page, payee: string) => page.getByRole("row").filter({ hasText: payee });
const editDialog = (page: Page) => page.getByRole("dialog", { name: "Edit", exact: true });

/** Opens the dialog of a payee's row with a click on the row. */
async function openEdit(page: Page, payee: string): Promise<Locator> {
  await page.goto(LAST_MONTH);
  await row(page, payee).getByText(payee).click();
  const dialog = editDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

async function pickCategory(page: Page, dialog: Locator, name: string) {
  await dialog.getByRole("button", { name: "Edit category" }).click();
  await page.getByRole("option", { name: new RegExp(name) }).click();
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: test.info().outputPath(`${name}.png`) });
}

test("a click on the row opens the dialog, and so does Enter on the row", async ({ page }) => {
  const dialog = await openEdit(page, "Edit cancel");
  await expect(dialog.getByRole("button", { name: "Expense" })).toHaveAttribute("aria-pressed", "true");
  await shot(page, "spesa");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  // The focus is back on the row it was opened from, and Enter opens it again.
  await expect(row(page, "Edit cancel")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(editDialog(page)).toBeVisible();
});

test("a spending takes another category", async ({ page }) => {
  const dialog = await openEdit(page, "Edit grocer");
  await pickCategory(page, dialog, "Bar e2e");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(row(page, "Edit grocer")).toContainText("Bar e2e");
});

test("a spending becomes a giroconto with one of the person's accounts", async ({ page }) => {
  const dialog = await openEdit(page, "Edit to account");
  await dialog.getByRole("button", { name: "Transfer" }).click();
  // No category for a giroconto, and no save until the other account is chosen.
  await expect(dialog.getByRole("button", { name: "Edit category" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
  await dialog.getByLabel("Other account").selectOption({ label: "Conto Due" });
  await shot(page, "giroconto");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(row(page, "Edit to account").getByTestId("transfer-route")).toHaveText(
    "From Conto Uno → to Conto Due",
  );
});

test("a spending becomes a giroconto with an account outside Ledgerly", async ({ page }) => {
  const dialog = await openEdit(page, "Edit to outside");
  await dialog.getByRole("button", { name: "Transfer" }).click();
  await dialog.getByLabel("Other account").selectOption({ label: "Outside account" });
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  const route = row(page, "Edit to outside").getByTestId("transfer-route");
  await expect(route).toHaveAttribute("data-state", "outside");
  await expect(route).toHaveText("From Conto Uno → to Outside account");
});

test("a giroconto becomes a spending with its category in one save", async ({ page }) => {
  const dialog = await openEdit(page, "Edit back");
  await expect(dialog.getByRole("button", { name: "Transfer" })).toHaveAttribute("aria-pressed", "true");
  await shot(page, "giroconto-aperto");
  await dialog.getByRole("button", { name: "Expense" }).click();
  await pickCategory(page, dialog, "Mercato e2e");
  await shot(page, "giroconto-a-spesa");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(row(page, "Edit back").getByTestId("transfer-route")).toHaveCount(0);
  await expect(row(page, "Edit back")).toContainText("Mercato e2e");
});

test("money in cannot be a spending, money out cannot be an income: the option is off and says why", async ({
  page,
}) => {
  const income = await openEdit(page, "Edit salary");
  await expect(income.getByRole("button", { name: "Expense" })).toBeDisabled();
  await expect(income.getByRole("button", { name: "Income" })).toHaveAttribute("aria-pressed", "true");
  await expect(income).toContainText("Money in is an income or a transfer");
  await shot(page, "entrata");
  await page.keyboard.press("Escape");

  const spending = await openEdit(page, "Edit cancel");
  await expect(spending.getByRole("button", { name: "Income" })).toBeDisabled();
  await expect(spending).toContainText("Money out is an expense or a transfer");
});

test("the bank's fields are shown and cannot be edited", async ({ page }) => {
  const dialog = await openEdit(page, "Edit cancel");
  const bank = dialog.getByTestId("bank-fields");
  await expect(bank).toContainText("Edit cancel");
  await expect(bank).toContainText("−8,70 €");
  await expect(bank).toContainText("Conto Uno");
  await expect(bank.locator("input, select, textarea")).toHaveCount(0);
  await expect(dialog.getByLabel("Amount")).toHaveCount(0);
  await expect(dialog.getByLabel("Payee")).toHaveCount(0);
});

test("the actions of the old row menu are in the dialog: a rule, and hide", async ({ page }) => {
  const dialog = await openEdit(page, "Edit hide");
  const actions = dialog.getByRole("region", { name: "Other actions" });
  await expect(actions.getByRole("button", { name: "Create a rule…" })).toBeVisible();
  await actions.getByRole("button", { name: "Hide" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("1 transaction hidden").last()).toBeVisible();
});

test("Cancel closes the dialog and saves nothing", async ({ page }) => {
  const dialog = await openEdit(page, "Edit salary");
  await dialog.getByRole("button", { name: "Transfer" }).click();
  await dialog.getByLabel("Other account").selectOption({ label: "Conto Due" });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(row(page, "Edit salary").getByTestId("transfer-route")).toHaveCount(0);
  await page.reload();
  await expect(row(page, "Edit salary").getByTestId("transfer-route")).toHaveCount(0);
});
