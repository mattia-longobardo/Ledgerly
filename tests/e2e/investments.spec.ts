// tests/e2e/investments.spec.ts — the manual account journey at 1440 px (docs/design/investments.md
// §1.3, §4; the tabs of investments-ux.md §3.2–§3.6, U3; PERS-342): a manual service is an account
// of Accounts the section shows — Directa typed by hand, its value updated from the broker and the
// profit or loss it gives; Fineco read by Wallet, its value and its deposit Wallet's — and Accounts
// shows the same value.
import { expect, type Page, test } from "@playwright/test";
import { sessionState } from "./env";

// Its own user: no service yet, two investment accounts in Accounts (scripts/seed-e2e.ts).
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

/** "Add manual account" from the catalog: an account of Accounts, never a new one (PERS-342). */
async function addManual(page: Page, account: string) {
  await page.goto("/investments/catalog");
  await page.getByRole("button", { name: "Add manual account" }).click();
  const dialog = page.getByRole("dialog", { name: "Add an account from Accounts" });
  await expect(dialog.getByLabel("Name")).toHaveCount(0);
  const select = dialog.getByLabel("Account");
  const label = await select.locator("option", { hasText: account }).first().textContent();
  await select.selectOption({ label: label ?? account });
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: account, level: 1 })).toBeVisible();
}

test("a manual service shows an account of Accounts, and Accounts shows the same value", async ({ page }) => {
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

  await test.step("Directa, typed by hand: its balance is the value, no positions, no deposits to type", async () => {
    await addManual(page, "Directa");
    await expect(await value(page)).toHaveText(/^8\.000,00\s€$/);
    await expect(
      page
        .getByRole("navigation", { name: "Sections of the service" })
        .getByRole("link", { name: "Positions" }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add operation" })).toHaveCount(0);
    const manual = page.getByTestId("manual-pnl");
    // Opened at yesterday's 8.000 €: that is the money in.
    await expect(manual).toHaveAttribute("data-invested-cents", "800000");
    await expect(manual).toHaveAttribute("data-pnl-cents", "0");
  });

  await test.step("worth 9.000 €: +1.000 €, +12,5 % of the 8.000 € in", async () => {
    await page.getByRole("button", { name: "Update value" }).click();
    const dialog = page.getByRole("dialog", { name: "Update the value of Directa" });
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

  await test.step("Accounts shows the same value, and keeps its balances editable", async () => {
    const service = page.url();
    await page.goto("/accounts");
    await expect(page.getByRole("row").filter({ hasText: "Directa" }).first()).toContainText(/9\.000,00\s€/);
    await page.goto(`${service.replace(/\?.*$/, "").replace(/\/investments\//, "/accounts/")}?tab=entries`);
    await expect(page.getByRole("link", { name: "Shown in Investments" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open in Investments" })).toHaveCount(0);
  });

  await test.step("Fineco, read by Wallet: Wallet's value and deposit, nothing to type", async () => {
    await addManual(page, "Fineco");
    await expect(page.getByTestId("sync-state")).toHaveText("Synced by Wallet");
    await expect(await value(page)).toHaveText(/^8\.000,00\s€$/);
    await expect(page.getByRole("button", { name: "Update value" })).toHaveCount(0);
    const manual = page.getByTestId("manual-pnl");
    await expect(manual).toHaveAttribute("data-invested-cents", "800000");
    await expect(manual).toHaveAttribute("data-pnl-cents", "0");
    await openTab(page, "Activity");
    const list = page.getByTestId("manual-activity");
    await expect(list.getByTestId("activity-item")).toHaveCount(1);
    await expect(list).toContainText("MATTIA LONGOBARDO");
    await expect(list).toContainText(/\+8\.000,00\s€/);
  });

  await test.step("the home counts both once (docs/design/investments-ux.md §3.1)", async () => {
    await page.goto("/investments");
    await expect(page.getByRole("heading", { name: /^(Profit and loss|P&L available) · / })).toBeVisible();
    await expect(page.getByTestId("pnl-hero")).toBeVisible();
  });
});
