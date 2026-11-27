// tests/e2e/transactions/manual-transfer.spec.ts — a giroconto written by hand between two accounts
// kept by hand (PERS-732): the server writes the other leg, and both balances follow at once.
//
// The `manualTransfer` user is this spec's own (scripts/seed-e2e.ts): "Contanti", kept by hand, with
// 80,00 € and one manual movement of 12,50 €; "Salvadanaio", kept by hand, with 20,00 €; "Zeta Bank
// conto", which a bank only reads. The test puts back what it changes.
import { expect, type Page, test } from "@playwright/test";
import { sessionState } from "../_shared/env";

test.use({ storageState: sessionState("manualTransfer") });

const EXPENSES = "/expenses?preset=last3Months";

const dialog = (page: Page) => page.getByTestId("manual-dialog");
/** The rows of one account, by the cell that names it. */
const rowsOf = (page: Page, account: string) =>
  page.getByRole("row").filter({ has: page.getByRole("cell", { name: account, exact: true }) });

/** The balance of an account as the Accounts page says it, in the row that carries its name. */
async function balanceOf(page: Page, account: string): Promise<string> {
  await page.goto("/accounts");
  const row = page.getByRole("row").filter({ hasText: account }).first();
  await expect(row).toBeVisible();
  return (await row.innerText()).replace(/\s+/g, " ");
}

test("a giroconto written by hand gets its other leg, and both balances follow", async ({ page }) => {
  await test.step("the two accounts start from their seeded balances", async () => {
    expect(await balanceOf(page, "Contanti")).toContain("67,50 €");
    expect(await balanceOf(page, "Salvadanaio")).toContain("20,00 €");
  });

  await test.step("the dialog writes a giroconto to the other account, with no category", async () => {
    await page.goto(EXPENSES);
    await page.getByRole("button", { name: "Add transaction" }).click();
    await expect(dialog(page).getByLabel("Account")).toBeEnabled();
    await dialog(page).getByLabel("Account").selectOption({ label: "Contanti" });
    await dialog(page).getByRole("button", { name: "Transfer" }).click();
    await expect(dialog(page).getByText("Category", { exact: true })).toHaveCount(0);
    await dialog(page).getByLabel("Other account").selectOption({ label: "Salvadanaio" });
    await dialog(page).getByLabel("Amount").fill("10");
    await dialog(page).getByLabel("Payee (optional)").fill("Risparmio");
    await page.getByRole("button", { name: "Add transaction" }).last().click();
    await expect(dialog(page)).toHaveCount(0);
  });

  await test.step("the list shows both legs at once, out of one account and into the other", async () => {
    await expect(rowsOf(page, "Contanti").filter({ hasText: "−10,00 €" })).toHaveCount(1);
    await expect(rowsOf(page, "Salvadanaio").filter({ hasText: "10,00 €" })).toHaveCount(1);
  });

  await test.step("Accounts shows both new balances", async () => {
    expect(await balanceOf(page, "Contanti")).toContain("57,50 €");
    expect(await balanceOf(page, "Salvadanaio")).toContain("30,00 €");
  });

  await test.step("choosing the other account again moves the other leg, with no reload", async () => {
    await page.goto(EXPENSES);
    const route = rowsOf(page, "Contanti").filter({ hasText: "−10,00 €" }).getByTestId("transfer-route");
    const choose = page.getByRole("dialog", { name: "Other account" });
    // A bank reads that account: its leg comes from the bank, so the written one goes.
    await route.click();
    await choose.getByLabel("Other account").selectOption({ label: "Zeta Bank conto" });
    await choose.getByRole("button", { name: "Save" }).click();
    await expect(rowsOf(page, "Salvadanaio")).toHaveCount(0);
    await route.click();
    await choose.getByLabel("Other account").selectOption({ label: "Salvadanaio" });
    await choose.getByRole("button", { name: "Save" }).click();
    await expect(rowsOf(page, "Salvadanaio").filter({ hasText: "10,00 €" })).toHaveCount(1);
    expect(await balanceOf(page, "Salvadanaio")).toContain("30,00 €");
  });

  await test.step("the giroconto opens in the dialog with its other account, which can change", async () => {
    await page.goto(EXPENSES);
    await rowsOf(page, "Contanti").filter({ hasText: "−10,00 €" }).getByText("Risparmio").click();
    await page
      .getByRole("dialog", { name: "Edit", exact: true })
      .getByRole("button", { name: "Edit transaction" })
      .click();
    await expect(dialog(page).getByRole("button", { name: "Transfer" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(dialog(page).getByLabel("Other account").locator("option:checked")).toHaveText(
      "Salvadanaio",
    );
    await expect(dialog(page).getByLabel("Other account")).toBeEnabled();
    await dialog(page).getByLabel("Amount").fill("15");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Transaction saved", { exact: true })).toBeVisible();
    expect(await balanceOf(page, "Contanti")).toContain("52,50 €");
    expect(await balanceOf(page, "Salvadanaio")).toContain("35,00 €");
  });

  await test.step("deleting the giroconto takes its other leg with it", async () => {
    await page.goto(EXPENSES);
    await rowsOf(page, "Contanti").filter({ hasText: "−15,00 €" }).getByText("Risparmio").click();
    await page
      .getByRole("dialog", { name: "Edit", exact: true })
      .getByRole("button", { name: "Delete" })
      .click();
    await page
      .getByRole("dialog", { name: "Delete this transaction?" })
      .getByRole("button", { name: "Delete" })
      .click();
    await expect(page.getByText("1 transaction deleted")).toBeVisible();
    expect(await balanceOf(page, "Contanti")).toContain("67,50 €");
    expect(await balanceOf(page, "Salvadanaio")).toContain("20,00 €");
  });
});
