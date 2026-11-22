// tests/e2e/investments/investments-groups.spec.ts — the one list of Investments (rewrite plan R5b,
// decisions B1, B1b, O1; 06-data.md: each subtotal of Investments is the figure of Overview, one total).
// The `layout` user has services, accounts with value only and pension funds.
import { expect, type Page, test } from "@playwright/test";
import { sessionState } from "../_shared/env";

test.use({ storageState: sessionState("layout") });

const GROUPS = ["stocks_crypto", "pension_funds"] as const;

/** The figure of a test id on the page as shown: the table at 1440 px, the list on a phone. */
const shown = (page: Page, testId: string) => page.getByTestId(testId).filter({ visible: true }).first();

test("one total: each group's subtotal is Overview's, and the value today is Overview's tile", async ({
  page,
}) => {
  await page.goto("/");
  const investments = await shown(page, "overview-group-investments").textContent();
  const overview = Object.fromEntries(
    await Promise.all(
      GROUPS.map(async (id) => [id, await shown(page, `overview-group-${id}`).getAttribute("data-cents")]),
    ),
  );
  expect(investments).not.toBe("");

  await page.goto("/investments");
  await expect(page.getByTestId("portfolio-value")).toContainText(investments!);
  for (const id of GROUPS) {
    const subtotal = page.getByTestId(`portfolio-group-${id}`).getByTestId("group-subtotal");
    await expect(subtotal).toHaveAttribute("data-cents", overview[id]!);
  }
});

test("the chip «Pension funds» keeps its group only, and a fund opens at its account", async ({ page }) => {
  await page.goto("/investments?preset=all");
  await page.getByRole("navigation", { name: "Groups" }).getByRole("link", { name: "Pension funds" }).click();
  await expect(page).toHaveURL(/group=pension_funds/);
  await expect(page).toHaveURL(/preset=all/);
  await expect(page.getByTestId("portfolio-group-stocks_crypto")).toHaveCount(0);
  await expect(page.getByTestId("pnl-hero")).toHaveCount(0);

  const fund = page.getByTestId("portfolio-group-pension_funds").getByTestId("portfolio-row").first();
  await expect(fund).toContainText("Pension fund");
  const name = (await fund.getByRole("link").textContent())!;
  await fund.getByRole("link").click();
  await expect(page).toHaveURL(/\/investments\/[0-9a-f-]{36}\?preset=all$/);
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Fund" })).toBeVisible();
});

test("the old addresses of Funds lead to Investments, never to a 404", async ({ page }) => {
  const funds = await page.goto("/funds?preset=all");
  expect(funds?.status()).toBe(200);
  await expect(page).toHaveURL(/\/investments\?.*group=pension_funds/);
  await expect(page).toHaveURL(/preset=all/);

  const href = await page
    .getByTestId("portfolio-group-pension_funds")
    .getByTestId("portfolio-row")
    .first()
    .getByRole("link")
    .getAttribute("href");
  const accountId = href!.match(/\/investments\/([0-9a-f-]{36})/)![1];
  await page.goto(`/investments/${accountId}?tab=settings`);
  const fundId = await page.evaluate(async (account) => {
    const answer = await fetch("/api/v1/investments/funds").then((response) => response.json());
    return answer.funds.find((one: { accountId: string }) => one.accountId === account).id as string;
  }, accountId);
  expect((await page.goto(`/funds/${fundId}?tab=valuations`))?.status()).toBe(200);
  await expect(page).toHaveURL(new RegExp(`/investments/${accountId}\\?tab=valuations$`));
  expect((await page.goto("/funds/new"))?.status()).toBe(200);
  await expect(page).toHaveURL(/\/investments\/new-fund$/);
  expect((await page.goto("/investments/catalog"))?.status()).toBe(200);
  await expect(page).toHaveURL(/\/investments$/);
});

test("an investment of Overview leads to its group in Investments", async ({ page }) => {
  await page.goto("/");
  const fund = page
    .locator("table")
    .getByRole("link")
    .filter({ visible: true })
    .and(page.locator('[href*="group=pension_funds"]'))
    .first();
  await fund.click();
  await expect(page).toHaveURL(/\/investments\?group=pension_funds$/);
  await expect(page.getByTestId("portfolio-group-pension_funds")).toBeVisible();
});
