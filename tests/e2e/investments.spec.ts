// tests/e2e/investments.spec.ts — the manual account journey at 1440 px (docs/design/investments.md
// §4, phase 2): a manual account from the catalog, its deposits (one linked to the bank movement it
// came from), a position bought with its fee, valued, closed — the value the engine gives at every
// step (§2.1, the Directa example) — the same value in Accounts, and a deletion that asks first.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { sessionState } from "./env";

// Its own user: no service yet, and two bank movements to link (scripts/seed-e2e.ts).
test.use({ storageState: sessionState("investments") });

const value = (page: Page) => page.getByTestId("service-value");

test("a manual account follows its operations, and Accounts shows the same value", async ({ page }) => {
  await test.step("an empty section sends to the catalog", async () => {
    await page.goto("/investments");
    await expect(page.getByRole("heading", { name: "No services yet" })).toBeVisible();
    await page.getByRole("link", { name: "Add service" }).first().click();
    await expect(page).toHaveURL(/\/investments\/catalog$/);
    // The providers still to connect are listed, with no way to connect them yet.
    await expect(page.getByTestId("catalog-card").filter({ hasText: "eToro" })).toContainText("Coming soon");
  });

  await test.step("a manual account per asset, in euro", async () => {
    await page.getByRole("button", { name: "Create manual account" }).click();
    const dialog = page.getByRole("dialog", { name: "Create manual account" });
    await dialog.getByLabel("Name").fill("Directa");
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("heading", { name: "Directa", level: 1 })).toBeVisible();
    await expect(value(page)).toHaveText(/^0,00\s€$/);
  });

  await test.step("two deposits, one linked to the money that left the bank", async () => {
    await page.getByRole("button", { name: "Deposit", exact: true }).first().click();
    let dialog = page.getByRole("dialog", { name: "Deposit" });
    await dialog.getByLabel("Amount").fill("8000");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();

    await page.getByRole("button", { name: "Deposit", exact: true }).first().click();
    dialog = page.getByRole("dialog", { name: "Deposit" });
    await dialog.getByLabel("Amount").fill("2000");
    const link = dialog.getByLabel("Linked account expense");
    await link.selectOption({ label: await optionLabel(link, "Bonifico eToro") });
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(value(page)).toHaveText(/^10\.000,00\s€$/);
    await expect(page.getByTestId("operation-row").first()).toContainText("Bonifico eToro");
  });

  await test.step("100 VWCE at 60 € with a 2 € fee: 9.998 €", async () => {
    await page.getByRole("button", { name: "Add asset" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Add asset" });
    await dialog.getByLabel("Search by name, ISIN or symbol").fill("VWCE");
    await dialog.getByLabel("Quantity").fill("100");
    await dialog.getByLabel("Unit price").fill("60");
    await dialog.getByLabel("Fee").fill("2");
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(value(page)).toHaveText(/^9\.998,00\s€$/);
    await expect(page.getByTestId("holding-row")).toContainText("Vanguard FTSE All-World");
  });

  await test.step("valued at 65 €: 10.498 €", async () => {
    await holdingAction(page, "Value");
    const dialog = page.getByRole("dialog", { name: /^Value · Vanguard/ });
    await dialog.getByLabel("Unit price").fill("65");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(value(page)).toHaveText(/^10\.498,00\s€$/);
  });

  await test.step("closed at 70 € with a 2 € fee: 10.996 €, all in cash", async () => {
    await holdingAction(page, "Close");
    const dialog = page.getByRole("dialog", { name: /^Close · Vanguard/ });
    await expect(dialog.getByLabel("Quantity")).toHaveValue("100");
    await dialog.getByLabel("Unit price").fill("70");
    await dialog.getByLabel("Fee").fill("2");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(value(page)).toHaveText(/^10\.996,00\s€$/);
    await expect(page.getByTestId("holding-row")).toHaveCount(0);
  });

  await test.step("Accounts shows the same value, and takes no manual balance for it", async () => {
    const service = page.url();
    await page.goto("/accounts");
    await expect(page.getByRole("row").filter({ hasText: "Directa" }).first()).toContainText(/10\.996,00\s€/);
    await page.goto(`${service.replace(/\/investments\//, "/accounts/")}?tab=entries`);
    await expect(page.getByRole("link", { name: "Open in Investments" })).toBeVisible();
    await page.goto(service);
  });

  await test.step("deleting an operation asks first, and says which one went", async () => {
    await page
      .getByTestId("operation-row")
      .first()
      .getByRole("button", { name: /^Actions for the operation of/ })
      .click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete this operation?" });
    await expect(dialog).toContainText("Close of");
    await dialog.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText(/^Deleted: Close of/)).toBeVisible();
    await expect(value(page)).toHaveText(/^10\.498,00\s€$/);
  });
});

async function holdingAction(page: Page, action: string): Promise<void> {
  await page
    .getByTestId("holding-row")
    .first()
    .getByRole("button", { name: /^Actions for Vanguard/ })
    .click();
  await page.getByRole("menuitem", { name: action }).click();
}

/** The full text of the first option naming `payee`: dates and amounts make up the rest of it. */
async function optionLabel(select: Locator, payee: string): Promise<string> {
  const option = select.locator("option", { hasText: payee }).first();
  await expect(option).toHaveCount(1);
  return (await option.textContent()) ?? "";
}
