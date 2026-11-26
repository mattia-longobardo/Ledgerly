// tests/e2e/investments/legs.spec.ts — a deposit's leg in the accounts (PERS-651) at 1440 px: the deposit
// of a manual portfolio paired with the bank transaction chosen in «From account», the link from its
// Activity row, the leg in Expenses with amount, date, account and delete kept to Investments, and the
// leg in the account's tab «Transactions». The pairing is the server's; the client only sends the choice.
import { expect, type Page, test } from "@playwright/test";
import { settledDialog } from "../_shared/a11y";
import { sessionState } from "../_shared/env";

// Its own user: «Broker» with no operation, and «Conto corrente» with two transfers of 1.000 € out
// to it, today and yesterday (scripts/seed-e2e/investments.ts, `seedLegs`).
test.use({ storageState: sessionState("legs") });
test.describe.configure({ mode: "serial" });

async function shot(page: Page, name: string) {
  await page.screenshot({ path: test.info().outputPath(`${name}.png`) });
}

test("a deposit paired with its bank transaction, and its leg in Expenses and Accounts", async ({ page }) => {
  await test.step("«From account» offers the bank transactions of those days, and one is chosen", async () => {
    await page.goto("/investments");
    await page
      .getByRole("link", { name: /^Broker$/ })
      .first()
      .click();
    await expect(page.getByRole("heading", { name: "Broker", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "Record operation" }).click();
    const dialog = page.getByRole("dialog", { name: "Record operation · Broker" });
    await dialog.getByLabel("Type").selectOption("deposit");
    const from = dialog.getByLabel("From account");
    // Automatic by default: the server's rule pairs the leg when nothing is chosen.
    await expect(from).toHaveValue("");
    await expect(from.locator("optgroup option")).toHaveCount(3);
    await expect(from.locator("option", { hasText: "BROKER SPA" })).toHaveCount(2);
    await expect(from.locator("option", { hasText: "An account outside Ledgerly" })).toHaveCount(1);
    await expect(from.locator("option", { hasText: "None: an income" })).toHaveCount(1);
    await dialog.getByLabel("Amount").fill("1000");
    // The list is newest first: the first bank transaction is today's.
    await from.selectOption({ index: 1 });
    await expect(from.locator("option:checked")).toContainText("BROKER SPA");
    await settledDialog(page);
    await shot(page, "1-deposit-from-account");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
  });

  await test.step("the Activity row links to its leg in Expenses", async () => {
    await page
      .getByRole("navigation", { name: "Sections of the service" })
      .getByRole("link", { name: "Activity" })
      .click();
    const leg = page.getByTestId("activity-leg").filter({ visible: true });
    await expect(leg).toHaveCount(1);
    await expect(leg).toHaveAccessibleName(/^Transaction in Expenses, /);
    await shot(page, "2-activity-leg");
    await leg.click();
    await page.waitForURL(/\/expenses\?/);
  });

  await test.step("in Expenses the leg is «Investments»: no delete, amount, date and account read only", async () => {
    const row = page.getByRole("row").filter({ hasText: "Investments" });
    await expect(row).toHaveCount(1);
    await row.getByText("Investments").click();
    const dialog = page.getByRole("dialog", { name: "Edit", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Recorded by Investments")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Delete" })).toHaveCount(0);
    await expect(dialog.getByLabel("Amount")).toHaveCount(0);
    // The type stays the person's: a giroconto, paired with the bank transaction chosen.
    await expect(dialog.getByRole("button", { name: "Transfer" })).toHaveAttribute("aria-pressed", "true");
    await settledDialog(page);
    await shot(page, "3-expenses-leg-locked");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  await test.step("the account's tab «Transactions» lists the leg", async () => {
    await page.goto("/accounts");
    await page.getByRole("link", { name: "Broker" }).filter({ visible: true }).first().click();
    await page.waitForURL(/\/accounts\/[0-9a-f-]{36}$/);
    await page.goto(`${new URL(page.url()).pathname}?tab=transactions`);
    const list = page.getByTestId("account-transactions");
    await expect(list.getByRole("row").filter({ hasText: "Investments" })).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Open in Expenses" })).toHaveAttribute(
      "href",
      /\/expenses\?acc=[0-9a-f-]{36}$/,
    );
    await shot(page, "4-account-transactions");
  });
});
