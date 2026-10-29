// tests/e2e/investments-service.spec.ts — a service's page in tabs (docs/design/investments-ux.md
// §1.1, §3.2–§3.6, U3), at 1440 px, as the seeded `layout` user (Directa, Fineco, eToro, Binance):
// the tabs are routes that carry the period and that Back walks; the service's P&L is its row on
// the home to the cent; Activity is paged, filtered by chip, and keeps the eToro page short.
import { expect, type Page, test } from "@playwright/test";
import { sessionState } from "./env";

test.use({ storageState: sessionState("layout") });

const tabs = (page: Page) => page.getByRole("navigation", { name: "Sections of the service" });

/** Opens a service from the home with the period of `query`, as a person would. */
async function openService(page: Page, name: string, query = ""): Promise<string> {
  await page.goto(`/investments${query}`);
  const link = page.getByRole("link", { name, exact: true }).filter({ visible: true }).first();
  const href = (await link.getAttribute("href"))!;
  await page.goto(href);
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  return href.replace(/\?.*$/, "");
}

test("the four tabs are pages that carry the period, and Back walks them", async ({ page }) => {
  const base = await openService(page, "eToro", "?period=all");
  await expect(page).toHaveURL(new RegExp(`${base}\\?period=all$`));
  await tabs(page).getByRole("link", { name: "Positions" }).click();
  await expect(page).toHaveURL(new RegExp(`${base}/positions\\?period=all$`));
  await tabs(page).getByRole("link", { name: "Activity" }).click();
  await expect(page).toHaveURL(new RegExp(`${base}/activity\\?period=all$`));
  await tabs(page)
    .getByRole("link", { name: /^Connection/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`${base}/connection\\?period=all$`));
  // Connection is always "today" (§2.3): no period to pick there.
  await expect(page.getByRole("group", { name: "Period" })).toHaveCount(0);

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${base}/activity\\?period=all$`));
  await expect(tabs(page).getByRole("link", { name: "Activity" })).toHaveAttribute("aria-current", "page");
  await page.goBack();
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${base}\\?period=all$`));
  await expect(tabs(page).getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");

  // A new period from a tab stays on that tab.
  await tabs(page).getByRole("link", { name: "Activity" }).click();
  await page.getByRole("group", { name: "Period" }).getByRole("link", { name: "Year" }).click();
  await expect(page).toHaveURL(new RegExp(`${base}/activity$`));
});

test("the service's P&L in the display currency is its row on the home, to the cent", async ({ page }) => {
  for (const [name, query] of [
    ["eToro", ""],
    ["Directa", ""],
    ["Directa", "?period=all"],
    ["Binance", "?period=all"],
  ] as const) {
    await page.goto(`/investments${query}`);
    const row = page.getByTestId("service-row").filter({ hasText: name }).first();
    const cell = row.getByTestId("service-pnl");
    const home = (await cell.count()) === 0 ? "" : await cell.getAttribute("data-cents");
    await openService(page, name, query);
    await expect(page.getByTestId("pnl-hero"), `${name}${query}`).toHaveAttribute("data-cents", home ?? "");
  }
});

test("Activity: the chips count the period and leave their own rows; the eToro page stays short", async ({
  page,
}) => {
  const base = await openService(page, "Directa", "?period=all");
  await tabs(page).getByRole("link", { name: "Activity" }).click();
  await expect(page).toHaveURL(new RegExp(`${base}/activity\\?period=all$`));
  await expect(page.getByTestId("activity-row").first()).toBeVisible();
  const chip = page.getByTestId("activity-chip").filter({ hasText: "Deposits and withdrawals" });
  const count = Number((await chip.textContent())!.replace(/.*·\s*/, ""));
  await chip.click();
  await expect(page).toHaveURL(new RegExp(`${base}/activity\\?period=all&type=flows$`));
  await expect(chip).toHaveAttribute("aria-current", "true");
  const rows = page.getByTestId("activity-row");
  await expect(rows).toHaveCount(Math.min(count, 50));
  for (const type of await rows.locator("td:nth-child(2)").allTextContents()) {
    expect(["Deposit", "Withdrawal", "Opening cash", "Opening position"]).toContain(type.trim());
  }
  // Never the legs of an event (§3.5, S4).
  await expect(page.locator("main")).not.toContainText(/\b(base|quote)\b/);

  await openService(page, "eToro", "?period=all");
  await tabs(page).getByRole("link", { name: "Activity" }).click();
  await expect(page.getByTestId("activity-range")).toBeVisible();
  const height = await page.locator("main").evaluate((main) => main.scrollHeight);
  expect(height, "the eToro Activity page is longer than 3,000 px").toBeLessThan(3000);
});
