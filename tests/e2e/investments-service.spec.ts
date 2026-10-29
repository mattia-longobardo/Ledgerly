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
  await expect(page).toHaveURL(new RegExp(`${base}/activity\\?period=all$`));
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

test("home → service → positions: the rows of Positions add up to the Overview's P&L (§3.4, U4)", async ({
  page,
}) => {
  for (const [name, query] of [
    ["Directa", ""],
    ["Directa", "?period=all"],
    ["Fineco Conto Deposito", ""],
    ["eToro", "?period=all"],
    ["Binance", "?period=all"],
  ] as const) {
    const base = await openService(page, name, query);
    const hero = page.getByTestId("pnl-hero");
    const local = await hero.getAttribute("data-local-cents");
    const display = await hero.getAttribute("data-cents");
    await tabs(page).getByRole("link", { name: "Positions" }).click();
    await expect(page).toHaveURL(new RegExp(`${base}/positions${query.replace("?", "\\?")}$`));
    const total = page.getByTestId("positions-total");
    if (local === "") {
      // An undetermined P&L has no rows to add up, and says so.
      await expect(total, `${name}${query}`).toHaveCount(0);
      continue;
    }
    await expect(total, `${name}${query}`).toHaveAttribute("data-cents", local ?? "");
    let sum = 0n;
    for (const cell of await page
      .locator('[data-testid="contribution-row"], [data-testid="contribution-part"]')
      .all()) {
      sum += BigInt((await cell.getAttribute("data-cents"))!);
    }
    expect(sum, `${name}${query}: Σ rows`).toBe(BigInt(local!));
    // A service in another currency says the Overview's number in the display currency too.
    if (name === "eToro" && display !== local)
      await expect(page.getByTestId("positions-bridge")).toBeVisible();
  }
});

test("Positions: open with a cost, closed in the period and ever, a past year on its last day", async ({
  page,
}) => {
  const base = await openService(page, "eToro", "?period=all");
  await tabs(page).getByRole("link", { name: "Positions" }).click();
  const voo = page.getByTestId("open-row").filter({ hasText: "Vanguard S&P 500" });
  // 0,5 × 540 $ worth 2.695,00 USD, 2.500,00 USD invested: +7,8 % on cost.
  await expect(voo).toContainText(/\+7,8\s?%/);
  const status = page.getByRole("group", { name: "Which positions" });
  await status.getByRole("link", { name: /^All closed/ }).click();
  await expect(page).toHaveURL(new RegExp(`${base}/positions\\?period=all&status=all$`));
  const tesla = page.getByTestId("closed-row").filter({ hasText: "Tesla" });
  await expect(tesla).toContainText("+100,00 USD");
  await expect(tesla).toContainText("1 position");
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${base}/positions\\?period=all$`));

  // A year before the data: the positions on its last day, and a link to today's.
  await page.goto(`${base}/positions?period=${new Date().getFullYear() - 1}`);
  await expect(status.getByRole("link", { name: /^Open on/ })).toHaveAttribute("aria-current", "true");
  await page.getByRole("link", { name: /^Today's positions/ }).click();
  await expect(page).toHaveURL(new RegExp(`${base}/positions\\?status=open$`));
});

test("Positions: grouped by class, the same rows under each class with its subtotal (§3.4)", async ({
  page,
}) => {
  const base = await openService(page, "Directa");
  await tabs(page).getByRole("link", { name: "Positions" }).click();
  const rows = await page.getByTestId("open-row").count();
  expect(rows).toBeGreaterThan(1);
  await page.getByRole("group", { name: "Group by" }).getByRole("link", { name: "Class" }).click();
  await expect(page).toHaveURL(new RegExp(`${base}/positions\\?by=class$`));
  await expect(page.getByRole("rowheader", { name: /^ETF/ })).toBeVisible();
  await expect(page.getByTestId("open-row")).toHaveCount(rows);
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
