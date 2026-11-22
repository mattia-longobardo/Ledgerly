// tests/e2e/funds/funds-home.spec.ts — the old addresses of Funds (rewrite plan R5b, decision B1b): its home
// is the chip «Pension funds» of Investments, a fund's page is its account's; with the invented years of
// the `fundsHome` seed. The home's own figures went with it: the fund's page keeps them (funds-detail).
import { expect, test } from "@playwright/test";
import { sessionState } from "../_shared/env";
import { FUNDS, fundLink, fundsList } from "./place";

test.use({ storageState: sessionState("fundsHome") });

test("the address of the preview does not answer any more", async ({ page }) => {
  const response = await page.goto("/funds/preview");
  expect(response?.status()).toBe(404);
  await expect(page.getByTestId("funds-hero")).toHaveCount(0);
});

test("no old address answers 404: the home, a fund with its query, and the form", async ({ page }) => {
  // The home leads to the chip «Pension funds», with its period; its own `view` has no twin there.
  const home = await page.request.get("/funds?off=1&view=value", { maxRedirects: 0 });
  expect(home.status()).toBe(308);
  await page.goto("/funds?off=1&view=value");
  await expect(page).toHaveURL(/\/investments\?off=1&group=pension_funds$/);
  await expect(fundLink(page, "Piano Beta")).toBeVisible();

  const beta = (await fundsList(page)).find((fund) => fund.name === "Piano Beta")!;
  const fund = await page.request.get(`/funds/${beta.id}?tab=valuations&off=1`, { maxRedirects: 0 });
  expect(fund.status()).toBe(308);
  await page.goto(`/funds/${beta.id}?tab=valuations&off=1`);
  await expect(page).toHaveURL(new RegExp(`/investments/${beta.accountId}\\?tab=valuations&off=1$`));
  await expect(page.getByTestId("fund-valuations")).toBeVisible();

  await page.goto("/funds/new");
  await expect(page).toHaveURL(/\/investments\/new-fund$/);
  await expect(page.getByTestId("fund-wizard")).toBeVisible();
});

test("the Contributions tab says a fee is unknown, and a debit with no amount reads well", async ({
  page,
}) => {
  await page.goto(`${FUNDS}&preset=all`);
  await fundLink(page, "Piano Delta").click();
  await page.getByRole("navigation", { name: "Fund" }).getByRole("link", { name: "Contributions" }).click();
  await expect(page.getByTestId("fee-unknown")).toContainText("A fee is unknown");
  // The debit's own card: what it looks for, with no amount and no fee in the sentence.
  const debit = page.getByTestId("fund-deposit-rule");
  await expect(debit).toContainText("Active");
  await expect(debit).toContainText("every month · from any account · payee contains “Delta”");
  await expect(debit).not.toContainText("€");
});
