// tests/e2e/accounts/overview-accounts.spec.ts — the card «Accounts» of Overview: each level of the list
// starts further right (bucket, group of Investments, account), each subtotal stands in the column of the
// balances, and the card ends with its list. Measured where things land, at 1440 and 400 px, in both
// themes, for three users: `layout` (buckets and groups of Investments), `expenses` (one bucket) and
// `pluginsOff` (no account: the `accounts` user gets some from accounts.spec.ts). Reads only.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { sessionState } from "../_shared/env";

const BUCKETS = ["cash", "savings", "investments", "other"];

/** Where the text of an element is, not its box: a cell's padding is not its words. */
const textBox = (locator: Locator) =>
  locator.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const { left, right, bottom } = range.getBoundingClientRect();
    return { left, right, bottom };
  });

const visible = (page: Page, selector: string) => page.locator(selector).filter({ visible: true });

/** The app reads its theme off `<html data-theme>` (tests/e2e/_shared/a11y.ts), set once it has settled. */
async function openOverview(page: Page, theme: "light" | "dark") {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeAttached();
  await page.waitForLoadState("networkidle");
  await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

const STATES = [
  { session: "layout", state: "groups" },
  { session: "expenses", state: "one bucket" },
] as const;

for (const width of [1440, 400]) {
  for (const theme of ["light", "dark"] as const) {
    for (const { session, state } of STATES) {
      test.describe(`${state}, ${width} px, ${theme} theme`, () => {
        test.use({ storageState: sessionState(session), viewport: { width, height: 900 } });

        test("the levels step right and the subtotals stand with the balances", async ({ page }) => {
          await openOverview(page, theme);
          const card = page.getByTestId("overview-accounts");
          await expect(visible(page, '[data-testid="overview-account-name"]').first()).toBeVisible();

          const labels = await visible(page, '[data-testid^="overview-group-label-"]').all();
          const keys = await Promise.all(
            labels.map(async (label) =>
              (await label.getAttribute("data-testid"))!.replace("overview-group-label-", ""),
            ),
          );
          const left = Object.fromEntries(
            await Promise.all(
              labels.map(async (label, i) => [keys[i], (await textBox(label)).left] as const),
            ),
          );
          const buckets = keys.filter((key) => BUCKETS.includes(key));
          const nested = keys.filter((key) => !BUCKETS.includes(key));
          if (state === "one bucket") expect(buckets).toHaveLength(1);
          if (state === "groups") expect(nested.length).toBeGreaterThan(0);

          const bucketLeft = left[buckets[0]!]!;
          for (const key of buckets) expect(Math.abs(left[key]! - bucketLeft)).toBeLessThan(1);
          for (const key of nested) expect(left[key]!).toBeGreaterThan(bucketLeft + 4);

          const names = await visible(page, '[data-testid="overview-account-name"]').all();
          for (const name of names) {
            const group = (await name.getAttribute("data-group"))!;
            expect((await textBox(name)).left).toBeGreaterThan(left[group]! + 4);
          }

          // One right edge for every subtotal and every balance: one column.
          const balances = await visible(page, '[data-testid="overview-account-balance"]').all();
          const edge = (await textBox(balances[0]!)).right;
          for (const balance of balances)
            expect(Math.abs((await textBox(balance)).right - edge)).toBeLessThan(1);
          for (const key of keys) {
            const total = card.getByTestId(`overview-group-${key}`).filter({ visible: true });
            expect(Math.abs((await textBox(total)).right - edge)).toBeLessThan(1);
          }

          // The card ends with its last row, not with the chart beside it.
          const cardBottom = (await card.boundingBox())!.y + (await card.boundingBox())!.height;
          const lastBottom = (await textBox(balances.at(-1)!)).bottom;
          expect(cardBottom - lastBottom).toBeLessThan(40);
        });
      });
    }

    test.describe(`no account, ${width} px, ${theme} theme`, () => {
      test.use({ storageState: sessionState("pluginsOff"), viewport: { width, height: 900 } });

      test("no card, the empty state", async ({ page }) => {
        await openOverview(page, theme);
        await expect(page.getByText("No accounts yet")).toBeVisible();
        await expect(page.getByTestId("overview-accounts")).toHaveCount(0);
      });
    });
  }
}
