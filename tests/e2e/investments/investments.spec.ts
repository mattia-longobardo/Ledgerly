// tests/e2e/investments/investments.spec.ts — the manual account journey at 1440 px (docs/design/investments.md
// §1.3, §4; the tabs of investments-ux.md §3.2–§3.6, U3; PERS-342): a manual service is an account
// of Accounts the section shows — Directa typed by hand, its value updated from the broker and the
// profit or loss it gives; Fineco read by Wallet, its value and its deposit Wallet's — and Accounts
// shows the same value.
import { expect, type Page, test } from "@playwright/test";
import { sessionState } from "../_shared/env";

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

/** «Account with value only» of «Add investment», on an account of Accounts (PERS-342). */
async function addManual(page: Page, account: string) {
  await page.goto("/investments");
  await page.getByRole("button", { name: "Add investment" }).first().click();
  await page
    .getByRole("dialog", { name: "Add investment" })
    .getByRole("button", { name: /^Account with value only/ })
    .click();
  const dialog = page.getByRole("dialog", { name: "Account with value only" });
  const select = dialog.getByLabel("Account");
  const label = await select.locator("option", { hasText: account }).first().textContent();
  await select.selectOption({ label: label ?? account });
  // An account of Accounts keeps its own name, currency and value: the fields of a new one go.
  await expect(dialog.getByLabel("Name")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: account, level: 1 })).toBeVisible();
}

test("a manual service shows an account of Accounts, and Accounts shows the same value", async ({ page }) => {
  await test.step("the accounts without a service are listed, and «Add investment» offers three choices", async () => {
    await page.goto("/investments");
    // B2: an investment account with no service yet is a row «Value only» of «Stocks and crypto».
    const group = page.getByTestId("portfolio-group-stocks_crypto");
    await expect(group.getByTestId("portfolio-row").filter({ hasText: "Directa" })).toContainText(
      "Value only",
    );
    await page.getByRole("button", { name: "Add investment" }).first().click();
    const choices = page.getByRole("dialog", { name: "Add investment" });
    await expect(choices.getByRole("button", { name: /^Connect a service/ })).toBeVisible();
    await expect(choices.getByRole("button", { name: /^Account with value only/ })).toBeVisible();
    await expect(choices.getByRole("link", { name: /^Pension fund/ })).toHaveAttribute(
      "href",
      "/investments/new-fund",
    );
    // B1c: «Connect a service» names the providers that connect, and none to come.
    await choices.getByRole("button", { name: /^Connect a service/ }).click();
    const connect = page.getByRole("dialog", { name: "Connect a service" });
    await expect(connect.getByTestId("provider-row").filter({ hasText: "eToro" })).toBeVisible();
    await expect(connect.getByTestId("provider-row").filter({ hasText: "Binance" })).toBeVisible();
    await expect(connect.getByTestId("provider-row").filter({ hasText: "Interactive Brokers" })).toHaveCount(
      0,
    );
    await expect(connect.getByText("Coming soon")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(connect).toBeHidden();
    // The catalog's old address leads to the home.
    await page.goto("/investments/catalog");
    await expect(page).toHaveURL(/\/investments$/);
  });

  await test.step("Directa, typed by hand: its balance is the value, no positions, no deposits to type", async () => {
    await addManual(page, "Directa");
    await expect(await value(page)).toHaveText(/^8\.000,00\s€$/);
    // No Positions and nothing to type but the value: investments-service.spec.ts, on Directa.
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
    await expect(page).toHaveURL(/[?&]preset=all/);
    await expect(page).not.toHaveURL(/range=|grain=/);
    await expect(
      page.getByRole("group", { name: "Date range" }).getByRole("link", { name: "All" }),
    ).toHaveAttribute("aria-current", "true");
    await openTab(page, "Activity");
    await expect(page).toHaveURL(/\/activity\?preset=all$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/investments\/[0-9a-f-]+\?preset=all$/);
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
    await expect(list).toContainText("MARIO ROSSI");
    await expect(list).toContainText(/\+8\.000,00\s€/);
  });
});
