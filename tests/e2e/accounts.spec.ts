// tests/e2e/accounts.spec.ts — the F1 journey at 1440 px (spec §11).
import { expect, test } from "@playwright/test";
import { sessionState } from "./env";

// Starts already signed in, from the session the seed prepared: the run's rate-limited sign-ins
// belong to the auth specs (tests/e2e/env.ts). This user is this spec's own, so the accounts it
// creates belong to no other test.
test.use({ storageState: sessionState("accounts") });

test("an account is created, kept up to date, summarised and snapshotted", async ({ page }) => {
  await test.step("a new user is told there is nothing to show yet", async () => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "No accounts yet" })).toBeVisible();
  });

  await test.step("creating an account with an opening balance opens it", async () => {
    await page.getByRole("link", { name: "Add account" }).first().click();
    await expect(page).toHaveURL("/accounts/new");
    await page.getByLabel("Name").fill("ING Conto Arancio");
    await page.getByLabel("Type").selectOption("checking");
    await page.getByLabel("Opening balance").fill("1.500,00");
    await page.getByLabel("Balance date").fill("2026-01-31");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page).toHaveURL(/\/accounts\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "ING Conto Arancio" })).toBeVisible();
    await expect(page.getByText("1.500,00 €").first()).toBeVisible();
  });

  const account = page.url();

  await test.step("a later balance is added and listed with its change", async () => {
    await page.goto(`${account}?tab=entries`);
    await page.getByLabel("Date").fill("2026-02-28");
    await page.getByLabel("Balance", { exact: true }).fill("1.750,50");
    await page.getByLabel("Note").fill("Statement Feb");
    await page.getByRole("button", { name: "Save balance" }).click();

    const rows = page.getByRole("row").filter({ hasText: "Statement Feb" });
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("1.750,50 €");
    await expect(rows.first()).toContainText("+250,50 €");
  });

  await test.step("the accounts page totals what the account holds", async () => {
    await page.getByRole("link", { name: "Accounts", exact: true }).first().click();
    await expect(page).toHaveURL("/accounts");
    await expect(page.getByRole("heading", { name: "Accounts", level: 1 })).toBeVisible();
    const row = page.getByRole("row").filter({ hasText: "ING Conto Arancio" });
    await expect(row).toContainText("1.750,50 €");
    await expect(page.getByRole("row").filter({ hasText: "Total" })).toContainText("1.750,50 €");
  });

  await test.step("the period and chart controls work without JavaScript state", async () => {
    await page.goto("/accounts");
    const columns = page.getByRole("columnheader");

    await page.getByRole("group", { name: "Granularity" }).getByRole("link", { name: "Year" }).click();
    await expect(page).toHaveURL(/grain=year/);
    await expect(columns.filter({ hasText: "Balance · 2026" })).toBeVisible();
    // Overview's chart, here too; its day grain is `chart=` and keeps the table's `grain=year`.
    await expect(page.getByRole("heading", { name: "Net worth over time" })).toBeVisible();
    await page.getByRole("group", { name: "Chart detail" }).getByRole("link", { name: "Day" }).click();
    await expect(page).toHaveURL(/chart=day/);
    await expect(page).toHaveURL(/grain=year/);
    await expect(page.getByRole("list", { name: "Accounts in the chart" })).toContainText(
      "ING Conto Arancio",
    );

    const period = page.getByRole("group", { name: "Period" });
    await period.getByRole("link", { name: "Previous period" }).click();
    await expect(page).toHaveURL(/off=1/);
    await expect(period.getByRole("link", { name: "Latest" })).toBeVisible();
    await period.getByRole("link", { name: "Latest" }).click();
    await expect(page).not.toHaveURL(/off=/);

    await page.goto(`${account}?span=3m`);
    await expect(page.getByRole("heading", { name: "Balance · 3 months" })).toBeVisible();
    await page.getByRole("group", { name: "Chart type" }).getByRole("link", { name: "Bars" }).click();
    await expect(page).toHaveURL(/mode=bars/);
  });

  await test.step("a past chart range moves the chart and leaves the header on today (F2.5)", async () => {
    await page.goto(account);
    await page.getByTitle("Chart range").click();
    await page.getByLabel("From", { exact: true }).fill("2026-01");
    await page.getByLabel("To", { exact: true }).fill("2026-01");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/from=2026-01&to=2026-01/);
    await expect(page.getByRole("heading", { name: "Balance · 1 month" })).toBeVisible();
    // January ended at 1.500,00 €; the header is about today, and today is 1.750,50 €.
    await expect(page.getByText("1.750,50 €").first()).toBeVisible();
    await expect(page.getByText("1.500,00 €").first()).toBeVisible();

    // A span drops the range again.
    await page.getByRole("group", { name: "Chart span" }).getByRole("link", { name: "1Y" }).click();
    await expect(page).not.toHaveURL(/from=/);
  });

  await test.step("the account chart goes down to the day, and keeps it across its other controls (F2.5)", async () => {
    await page.goto(account);
    await page.getByRole("group", { name: "Chart detail" }).getByRole("link", { name: "Day" }).click();
    await expect(page).toHaveURL(/grain=day/);
    await page.getByRole("group", { name: "Chart type" }).getByRole("link", { name: "Bars" }).click();
    await expect(page).toHaveURL(/grain=day/);
    await expect(page).toHaveURL(/mode=bars/);
    await expect(page.getByRole("figure")).toContainText("Day-by-day change");
  });

  await test.step("settings rename the account and set a balance warning", async () => {
    await page.goto(`${account}?tab=settings`);
    await page.getByLabel("Name").fill("ING main");
    await page.getByLabel("Warn below").fill("2.000,00");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Account saved")).toBeVisible();

    await page.goto("/accounts");
    await expect(page.getByRole("row").filter({ hasText: "ING main" })).toBeVisible();
  });

  await test.step("overview shows the net worth the account makes up", async () => {
    await page.getByRole("link", { name: "Overview" }).first().click();
    await expect(page).toHaveURL("/");
    await expect(page.getByText("1.750,50 €").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Net worth over time" })).toBeVisible();

    // Overview has the same picker (F2.5); a range ending in January keeps the hero on today.
    await page.getByTitle("Chart range").click();
    await page.getByLabel("From", { exact: true }).fill("2026-01");
    await page.getByLabel("To", { exact: true }).fill("2026-02");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/from=2026-01&to=2026-02/);
    await expect(page.locator("p.text-hero")).toHaveText("1.750,50 €");
    // The stacked chart names each account under it, with its share of the total.
    const legend = page.getByRole("list", { name: "Accounts in the chart" });
    await expect(legend).toContainText("ING main");
    await expect(legend).toContainText("100");

    // Day by day too, keeping the range.
    await page.getByRole("group", { name: "Chart detail" }).getByRole("link", { name: "Day" }).click();
    await expect(page).toHaveURL(/grain=day/);
    await expect(page).toHaveURL(/from=2026-01/);
    await expect(legend).toContainText("ING main");
  });

  await test.step("a snapshot can be taken at once and lands in the log", async () => {
    await page.goto("/settings/data");
    await page.getByRole("button", { name: "Take snapshot now" }).click();
    await expect(page.getByText("Snapshot taken")).toBeVisible();
    await expect(page.getByRole("table").getByRole("row")).toHaveCount(2);
  });
});

/**
 * The Danger zone (spec §7.1). Until F9 its only button said "Archive account" and called the
 * action that **removes** one: one click, no confirmation, and an account with every movement and
 * balance it held was gone for good — verified on the deployed site, 2026-09-21 (rilievo E1).
 * It now asks first and says which of the two things it did.
 */
test("removing an account asks first, and says whether it was deleted or archived", async ({ page }) => {
  await page.goto("/accounts/new");
  await page.getByLabel("Name").fill("Conto di prova F9");
  await page
    .getByRole("button", { name: /Save|Create|Add/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/accounts\/[0-9a-f-]{36}/);
  const url = page.url().split("?")[0];

  await page.goto(`${url}?tab=settings`);
  await page.getByRole("button", { name: "Remove account" }).first().click();

  // The dialog says what may happen, and closing it leaves the account alone.
  const dialog = page.getByRole("dialog", { name: "Remove this account?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("deleted for good");
  await dialog.getByRole("button", { name: "Keep it" }).click();
  await expect(dialog).toBeHidden();
  expect((await page.goto(url))?.status()).toBe(200);

  // Confirming removes it, and the message says which of the two happened.
  await page.goto(`${url}?tab=settings`);
  await page.getByRole("button", { name: "Remove account" }).first().click();
  await page
    .getByRole("dialog", { name: "Remove this account?" })
    .getByRole("button", { name: "Remove account" })
    .click();
  await expect(page).toHaveURL(/\/accounts$/);
  const toast = page.getByRole("region", { name: "Notifications" });
  await expect(toast).toContainText("Conto di prova F9");
  await expect(toast).toContainText(/deleted|archived/);
  expect((await page.goto(url))?.status()).toBe(404);
});
