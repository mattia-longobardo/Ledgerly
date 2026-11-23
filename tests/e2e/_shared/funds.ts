// tests/e2e/funds/place.ts — where a fund is since R5b (decision B1b): a row of «Pension funds» on the
// Investments home, its page at its account's address in Investments.
import type { Page } from "@playwright/test";

/** The pension funds of the Investments home: the old `/funds` leads here. */
export const FUNDS = "/investments?group=pension_funds";

/** A fund's link in its row of «Pension funds». */
export const fundLink = (page: Page, name: string) =>
  page.getByTestId("portfolio-group-pension_funds").getByRole("link", { name, exact: true });

/** The fund's own address, read from its row; `query` is the period the home is opened with. */
export async function fundPath(page: Page, name: string, query = ""): Promise<string> {
  await page.goto(`${FUNDS}${query.replace("?", "&")}`);
  const href = await fundLink(page, name).getAttribute("href");
  return href!.split("?")[0];
}

/** `GET /api/v1/investments/funds` as the page's person: every fund, the archived ones too. */
export async function fundsList(
  page: Page,
): Promise<{ id: string; accountId: string; name: string; gain: string | null }[]> {
  if (!page.url().startsWith("http")) await page.goto("/");
  return page.evaluate(async () => (await (await fetch("/api/v1/investments/funds")).json()).funds);
}

/** A decimal of the wire ("−12.30") as cents. */
export const cents = (amount: string) => BigInt(Math.round(Number(amount) * 100));

/** «Add investment» › «Pension fund» on the Investments home: where «Add fund» of Funds went. */
export async function addFund(page: Page): Promise<void> {
  await page.goto("/investments");
  await page.getByRole("button", { name: "Add investment" }).first().click();
  await page
    .getByRole("dialog", { name: "Add investment" })
    .getByRole("link", { name: /^Pension fund/ })
    .click();
}
