// tests/e2e/investments.spec.ts — the manual account journey at 1440 px (docs/design/investments.md
// §4; the tabs of investments-ux.md §3.2–§3.6, U3): a manual account from the catalog, its deposits
// (one linked to the bank movement it came from) and a withdrawal, the value typed from the broker
// and the profit or loss it gives (PERS-335: no positions), the same value in Accounts, and a
// deletion that asks first.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { sessionState } from "./env";

// Its own user: no service yet, and two bank movements to link (scripts/seed-e2e.ts).
test.use({ storageState: sessionState("investments") });

/** The value today, on the Overview tab: every other tab is opened from there and back. */
async function value(page: Page) {
  await openTab(page, "Overview");
  return page.getByTestId("service-value");
}

async function openTab(page: Page, name: "Overview" | "Activity" | "Connection" | "Settings") {
  await page.getByRole("navigation", { name: "Sections of the service" }).getByRole("link", { name }).click();
  await expect(
    page.getByRole("navigation", { name: "Sections of the service" }).getByRole("link", { name }),
  ).toHaveAttribute("aria-current", "page");
}

/** "Add operation" of a manual account (§3.2): one primary button, the kinds in its menu. */
async function addOperation(page: Page, kind: "Deposit" | "Withdrawal" | "Update value") {
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

  await test.step("a manual account in euro: no mode to choose, no positions", async () => {
    await page.getByRole("button", { name: "Create manual account" }).click();
    const dialog = page.getByRole("dialog", { name: "Create manual account" });
    await expect(dialog.getByRole("radio")).toHaveCount(0);
    await dialog.getByLabel("Name").fill("Directa");
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("heading", { name: "Directa", level: 1 })).toBeVisible();
    await expect(await value(page)).toHaveText(/^0,00\s€$/);
    await expect(
      page
        .getByRole("navigation", { name: "Sections of the service" })
        .getByRole("link", { name: "Positions" }),
    ).toHaveCount(0);
  });

  await test.step("10.000 € in two deposits, one linked to the money that left the bank", async () => {
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
    await openTab(page, "Activity");
    await expect(page.getByTestId("activity-row").filter({ hasText: "Bonifico eToro" })).toHaveCount(1);
  });

  await test.step("2.000 € out: no value typed yet, so no profit or loss, and the page asks for one", async () => {
    await addOperation(page, "Withdrawal");
    const dialog = page.getByRole("dialog", { name: "Withdrawal" });
    await dialog.getByLabel("Amount").fill("2000");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await openTab(page, "Overview");
    const manual = page.getByTestId("manual-pnl");
    await expect(manual).toHaveAttribute("data-invested-cents", "800000");
    await expect(manual).toHaveAttribute("data-pnl-cents", "");
    await expect(page.getByTestId("manual-stale")).toContainText("No value recorded");
  });

  await test.step("worth 9.000 €: +1.000 €, +12,5 % of the 8.000 € left in", async () => {
    await addOperation(page, "Update value");
    const dialog = page.getByRole("dialog", { name: "Update value" });
    await dialog.getByLabel("Value").fill("9000");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(await value(page)).toHaveText(/^9\.000,00\s€$/);
    const manual = page.getByTestId("manual-pnl");
    await expect(manual).toHaveAttribute("data-pnl-cents", "100000");
    await expect(manual).toContainText(/8\.000,00\s€/);
    await expect(manual).toContainText(/\+1\.000,00\s€/);
    await expect(manual).toContainText(/\+12,5\s?%/);
    await expect(page.getByTestId("manual-stale")).toHaveCount(0);
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
    await expect(page.getByRole("row").filter({ hasText: "Directa" }).first()).toContainText(/9\.000,00\s€/);
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
    await expect(dialog).toContainText("Account value");
    await dialog.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText(/^Deleted: Account value/)).toBeVisible();
    // Without the value typed, money went in and nobody valued the account: no value, never zero.
    await expect(await value(page)).toHaveText("no value yet");
    await expect(page.getByTestId("manual-pnl")).toHaveAttribute("data-pnl-cents", "");
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

/** The full text of the first option naming `payee`: dates and amounts make up the rest of it. */
async function optionLabel(select: Locator, payee: string): Promise<string> {
  const option = select.locator("option", { hasText: payee }).first();
  await expect(option).toHaveCount(1);
  return (await option.textContent()) ?? "";
}
