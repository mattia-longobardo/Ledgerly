// tests/e2e/investments.spec.ts — the manual account journey at 1440 px (docs/design/investments.md
// §4, phase 2; the tabs of investments-ux.md §3.2–§3.6, U3): a manual account from the catalog, its
// deposits (one linked to the bank movement it came from), a position bought with its fee, valued,
// closed — the value the engine gives at every step (§2.1, the Directa example) — the same value in
// Accounts, and a deletion that asks first.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { sessionState } from "./env";

// Its own user: no service yet, and two bank movements to link (scripts/seed-e2e.ts).
test.use({ storageState: sessionState("investments") });

/** The value today, on the Overview tab: every other tab is opened from there and back. */
async function value(page: Page) {
  await openTab(page, "Overview");
  return page.getByTestId("service-value");
}

async function openTab(page: Page, name: "Overview" | "Positions" | "Activity" | "Connection" | "Settings") {
  await page.getByRole("navigation", { name: "Sections of the service" }).getByRole("link", { name }).click();
  await expect(
    page.getByRole("navigation", { name: "Sections of the service" }).getByRole("link", { name }),
  ).toHaveAttribute("aria-current", "page");
}

/** "Add operation" of a manual account (§3.2): one primary button, the kinds in its menu. */
async function addOperation(page: Page, kind: "Buy" | "Deposit" | "Withdrawal" | "Update value") {
  await page.getByRole("button", { name: "Add operation" }).click();
  await page.getByRole("menuitem", { name: kind, exact: true }).click();
}

test("a manual account follows its operations, and Accounts shows the same value", async ({ page }) => {
  await test.step("an empty section sends to the catalog", async () => {
    await page.goto("/investments");
    await expect(page.getByRole("heading", { name: "No services yet" })).toBeVisible();
    await page.getByRole("link", { name: "Add service" }).first().click();
    await expect(page).toHaveURL(/\/investments\/catalog$/);
    // C1: both providers that connect are named; C2: the rest is closed under "Coming soon", with
    // its count, and Kraken is not listed.
    await expect(page.getByText("eToro and Binance connect with a read-only key")).toBeVisible();
    await expect(page.getByTestId("catalog-card").filter({ hasText: "eToro" })).toContainText("Available");
    await expect(page.getByTestId("catalog-card").filter({ hasText: "Binance" })).toContainText("Available");
    await expect(page.getByTestId("catalog-card").filter({ hasText: "Kraken" })).toHaveCount(0);
    const planned = page.getByTestId("catalog-planned");
    await expect(planned).not.toHaveAttribute("open");
    await expect(planned.getByText(/^Coming soon · \d+$/)).toBeVisible();
    const ibkr = planned.getByTestId("catalog-card").filter({ hasText: "Interactive Brokers" });
    await expect(ibkr).toBeHidden();
    await planned.getByText(/^Coming soon · \d+$/).click();
    await expect(ibkr).toContainText("Coming soon");
  });

  await test.step("a manual account per asset, in euro", async () => {
    await page.getByRole("button", { name: "Create manual account" }).click();
    const dialog = page.getByRole("dialog", { name: "Create manual account" });
    await dialog.getByLabel("Name").fill("Directa");
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("heading", { name: "Directa", level: 1 })).toBeVisible();
    await expect(await value(page)).toHaveText(/^0,00\s€$/);
  });

  await test.step("two deposits, one linked to the money that left the bank", async () => {
    await addOperation(page, "Deposit");
    let dialog = page.getByRole("dialog", { name: "Deposit" });
    await dialog.getByLabel("Amount").fill("8000");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();

    await addOperation(page, "Deposit");
    dialog = page.getByRole("dialog", { name: "Deposit" });
    await dialog.getByLabel("Amount").fill("2000");
    // The link offers only the same amount within three days; a search finds any movement (D3).
    const link = dialog.getByLabel("Linked account expense");
    await expect(link.locator("option")).toHaveCount(1);
    await dialog.getByLabel("Search a bank movement").fill("Bonifico eToro");
    await link.selectOption({ label: await optionLabel(link, "Bonifico eToro") });
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(await value(page)).toHaveText(/^10\.000,00\s€$/);
    await openTab(page, "Activity");
    await expect(page.getByTestId("activity-row").filter({ hasText: "Bonifico eToro" })).toHaveCount(1);
  });

  await test.step("100 VWCE at 60 € with a 2 € fee: 9.998 €", async () => {
    await addOperation(page, "Buy");
    const dialog = page.getByRole("dialog", { name: "Add asset" });
    // D1: nothing chosen, the search on the account's currency; a search picks the first match.
    await expect(dialog.getByLabel("Asset", { exact: true })).toHaveValue("");
    await expect(dialog.getByLabel("Currency", { exact: true })).toHaveValue("EUR");
    await dialog.getByLabel("Search by name, ISIN or symbol").fill("VWCE");
    await dialog.getByLabel("Quantity").fill("100");
    await dialog.getByLabel("Unit price").fill("60");
    await dialog.getByLabel("Fee").fill("2");
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(await value(page)).toHaveText(/^9\.998,00\s€$/);
    await openTab(page, "Positions");
    await expect(page.getByTestId("open-row")).toContainText("Vanguard FTSE All-World");
  });

  await test.step("valued at 65 €: 10.498 €", async () => {
    await holdingAction(page, "Value");
    const dialog = page.getByRole("dialog", { name: /^Value · Vanguard/ });
    await dialog.getByLabel("Unit price").fill("65");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(await value(page)).toHaveText(/^10\.498,00\s€$/);
  });

  await test.step("closed at 70 € with a 2 € fee: 10.996 €, all in cash", async () => {
    await openTab(page, "Positions");
    await holdingAction(page, "Close");
    const dialog = page.getByRole("dialog", { name: /^Close · Vanguard/ });
    await expect(dialog.getByLabel("Quantity")).toHaveValue("100");
    await dialog.getByLabel("Unit price").fill("70");
    await dialog.getByLabel("Fee").fill("2");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("open-row")).toHaveCount(0);
    await expect(await value(page)).toHaveText(/^10\.996,00\s€$/);
  });

  await test.step("the closed position: what it cost, what came back, and the Overview's P&L (§3.4)", async () => {
    await openTab(page, "Positions");
    await page
      .getByRole("group", { name: "Which positions" })
      .getByRole("link", { name: /^Closed in/ })
      .click();
    await expect(page).toHaveURL(/\/positions\?status=closed$/);
    const row = page.getByTestId("closed-row").filter({ hasText: "Vanguard FTSE All-World" });
    // 100 bought at 60 (6.000 €), closed at 70 (7.000 €): +1.000 €, the fees apart.
    await expect(row).toContainText(/6\.000,00\s€/);
    await expect(row).toContainText(/7\.000,00\s€/);
    await expect(row).toContainText(/\+1\.000,00\s€/);
    const total = await page.getByTestId("positions-total").getAttribute("data-cents");
    await openTab(page, "Overview");
    await expect(page.getByTestId("pnl-hero")).toHaveAttribute("data-local-cents", total ?? "");
  });

  await test.step("the chart's old address lands on the period, and the tabs carry it (§1.2)", async () => {
    const service = page.url().replace(/\?.*$/, "");
    await page.goto(`${service}?range=all&grain=day`);
    await expect(page).toHaveURL(/[?&]period=all/);
    await expect(page).not.toHaveURL(/range=|grain=/);
    await expect(
      page.getByRole("group", { name: "Period" }).getByRole("link", { name: "All" }),
    ).toHaveAttribute("aria-current", "true");
    await openTab(page, "Activity");
    await expect(page).toHaveURL(/\/activity\?period=all$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/investments\/[0-9a-f-]+\?period=all$/);
    await page.goto(service);
  });

  await test.step("Accounts shows the same value, and takes no manual balance for it", async () => {
    const service = page.url();
    await page.goto("/accounts");
    await expect(page.getByRole("row").filter({ hasText: "Directa" }).first()).toContainText(/10\.996,00\s€/);
    await page.goto(`${service.replace(/\?.*$/, "").replace(/\/investments\//, "/accounts/")}?tab=entries`);
    await expect(page.getByRole("link", { name: "Open in Investments" })).toBeVisible();
    await page.goto(service);
  });

  await test.step("deleting an operation asks first, and says which one went", async () => {
    await openTab(page, "Activity");
    await page
      .getByTestId("activity-row")
      .first()
      .getByRole("button", { name: /^Actions for the operation of/ })
      .click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete this operation?" });
    await expect(dialog).toContainText("Close of");
    await dialog.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText(/^Deleted: Close of/)).toBeVisible();
    await expect(await value(page)).toHaveText(/^10\.498,00\s€$/);
  });
});

test("a withdrawal and a deposit between two services are proposed, linked and unlinked as a transfer", async ({
  page,
}) => {
  await test.step("1.000 € into a second service, 1.000 € out of Directa", async () => {
    await page.goto("/investments/catalog");
    await page.getByRole("button", { name: "Create manual account" }).click();
    const create = page.getByRole("dialog", { name: "Create manual account" });
    await create.getByLabel("Name").fill("Conto Deposito");
    await create.getByRole("button", { name: "Create", exact: true }).click();
    await expect(create).toBeHidden();
    await expect(page.getByRole("heading", { name: "Conto Deposito", level: 1 })).toBeVisible();
    await addOperation(page, "Deposit");
    let dialog = page.getByRole("dialog", { name: "Deposit", exact: true });
    await dialog.getByLabel("Amount").fill("1000");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();

    await page.goto("/investments");
    await page.getByRole("link", { name: "Directa", exact: true }).filter({ visible: true }).first().click();
    await expect(page.getByRole("heading", { name: "Directa", level: 1 })).toBeVisible();
    await addOperation(page, "Withdrawal");
    dialog = page.getByRole("dialog", { name: "Withdrawal", exact: true });
    await dialog.getByLabel("Amount").fill("1000");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
  });

  await test.step("the pair is proposed, and linked it shows on the operation", async () => {
    await openTab(page, "Activity");
    const proposal = page.getByTestId("transfer-proposal");
    await expect(proposal).toHaveCount(1);
    await expect(proposal).toContainText("Conto Deposito");
    await proposal.getByRole("button", { name: /^Link as transfer/ }).click();
    await expect(page.getByText("Transfer linked")).toBeVisible();
    await expect(page.getByTestId("transfer-proposal")).toHaveCount(0);
    const row = page.getByTestId("activity-row").filter({ hasText: "to Conto Deposito" });
    await expect(row).toHaveCount(1);
  });

  await test.step("the home leads with the P&L of the year (docs/design/investments-ux.md §3.1)", async () => {
    const service = page.url();
    await page.goto("/investments");
    await expect(page.getByRole("heading", { name: /^(Profit and loss|P&L available) · / })).toBeVisible();
    await expect(page.getByTestId("pnl-hero")).toBeVisible();
    await page.goto(service);
  });

  await test.step("unlinked, the pair is proposed again", async () => {
    await page
      .getByTestId("activity-row")
      .filter({ hasText: "to Conto Deposito" })
      .getByRole("button", { name: /^Unlink transfer/ })
      .click();
    await expect(page.getByText("Transfer unlinked")).toBeVisible();
    await expect(page.getByTestId("transfer-proposal")).toHaveCount(1);
  });
});

async function holdingAction(page: Page, action: string): Promise<void> {
  await page
    .getByTestId("open-row")
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
