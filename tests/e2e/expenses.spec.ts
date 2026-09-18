// tests/e2e/expenses.spec.ts — the F2 journey at 1440 px (spec §11).
import { expect, type Page, test } from "@playwright/test";
import { sessionState } from "./env";

// Starts already signed in, from the session the seed prepared, with the movements the seed
// applied through `upsertFromProvider` on a synced Wallet account. This user is this spec's own.
test.use({ storageState: sessionState("expenses") });

/**
 * The count beside the page title. The month group row and the phone list say a similar sentence,
 * so the header is addressed through the heading it sits next to rather than by text.
 */
const summary = (page: Page) =>
  page
    .locator("div", { has: page.getByRole("heading", { level: 1 }) })
    .last()
    .locator("p")
    .first();

/** The range's net beside the count: income plus spending, never a transfer (spec §7.2, F2.5). */
const net = (page: Page) =>
  page.locator("dt", { hasText: /^Net$/ }).locator("xpath=following-sibling::dd[1]");

test("synced movements are filtered, recategorised and hidden, and the totals follow", async ({ page }) => {
  await test.step("the month opens with the movements the sync brought in", async () => {
    await page.goto("/expenses");
    await expect(page.getByRole("heading", { name: "Expenses", level: 1 })).toBeVisible();
    // This month is seeded with four movements; the fifth is last month's and must not be here.
    // The seed derives both from today, so this journey does not go stale (scripts/seed-e2e.ts).
    const rows = page.getByRole("row").filter({ hasText: "Netflix" });
    await expect(rows).toHaveCount(1);
    await expect(page.getByRole("row").filter({ hasText: "Esselunga" })).toHaveCount(1);
    await expect(page.getByRole("row").filter({ hasText: "Stipendio" })).toHaveCount(1);
    // −12,99 − 45,50 − 21,00 + 2.100,00 = 2.020,51, with the thousands separator of §8.4 point 1.
    await expect(summary(page)).toHaveText("4 transactions");
    await expect(net(page)).toHaveText("+2.020,51 €");
  });

  await test.step("the spending chart stacks the range by group, day by day on a month (F2.5)", async () => {
    await expect(page.getByRole("heading", { name: "Spending over time" })).toBeVisible();
    const legend = page.getByRole("list", { name: "Groups in the chart" });
    for (const group of ["Abbonamenti", "Spesa", "Trasporti"]) await expect(legend).toContainText(group);
    // −12,99 − 45,50 − 21,00: the salary is income, not spending.
    await expect(page.getByText("79,49 €").first()).toBeVisible();
    await page.getByRole("group", { name: "Chart detail" }).getByRole("link", { name: "Month" }).click();
    await expect(page).toHaveURL(/grain=month/);
    await page.goto("/expenses");
  });

  await test.step("the payee search narrows the table and lives in the URL", async () => {
    // The field and its submit button share the label; `type="search"` makes the field a searchbox.
    const search = page.getByRole("searchbox", { name: "Search by payee" });
    await search.fill("netfl");
    await search.press("Enter");
    await expect(page).toHaveURL(/q=netfl/);
    await expect(page.getByRole("row").filter({ hasText: "Netflix" })).toHaveCount(1);
    await expect(page.getByRole("row").filter({ hasText: "Esselunga" })).toHaveCount(0);
  });

  await test.step("the filters clear back to the whole month", async () => {
    await page.getByRole("link", { name: "Clear filters" }).click();
    await expect(page.getByRole("row").filter({ hasText: "Esselunga" })).toHaveCount(1);
  });

  await test.step("a category set by hand sticks to the movement", async () => {
    const row = page.getByRole("row").filter({ hasText: "Stipendio" });
    await row.getByRole("button", { name: "Edit category" }).first().click();
    await page.getByRole("menuitem", { name: "Spesa" }).click();
    await expect(page.getByRole("row").filter({ hasText: "Stipendio" })).toContainText("Spesa");
  });

  await test.step("hiding a movement takes it out of the totals, and Show hidden brings it back", async () => {
    const row = page.getByRole("row").filter({ hasText: "Trenitalia" });
    await row.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Hide", exact: true }).click();

    await expect(page.getByRole("row").filter({ hasText: "Trenitalia" })).toHaveCount(0);
    await expect(summary(page)).toHaveText("3 transactions");
    await expect(net(page)).toHaveText("+2.041,51 €");

    await page.getByRole("link", { name: "Show hidden" }).click();
    await expect(page).toHaveURL(/hidden=1/);
    const hidden = page.getByRole("row").filter({ hasText: "Trenitalia" });
    await expect(hidden).toHaveCount(1);
    await expect(hidden).toContainText("Hidden");

    await hidden.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Restore", exact: true }).click();
    await expect(summary(page)).toHaveText("4 transactions");
    await expect(net(page)).toHaveText("+2.020,51 €");
  });

  await test.step("the By category card breaks the range down", async () => {
    await page.goto("/expenses");
    await expect(page.getByRole("heading", { name: "By category" })).toBeVisible();
    // The card has no landmark role; its rows are the only list items on the screen.
    for (const category of ["Abbonamenti", "Spesa", "Trasporti"]) {
      await expect(page.getByRole("listitem").filter({ hasText: category }).first()).toBeVisible();
    }
  });

  await test.step("sorting puts the order in the URL, so the server renders it", async () => {
    await page.goto("/expenses");
    await page.getByRole("button", { name: /Amount/ }).click();
    await expect(page).toHaveURL(/sort=amount/);
    // Amount opens descending, and the month header is gone: grouping by month only means
    // something in date order, so sorting by amount is deliberately a flat list.
    await expect(page.getByRole("row").nth(1)).toContainText("Stipendio");
    await expect(page.getByRole("row").last()).toContainText("Esselunga");
    await expect(summary(page)).toHaveText("4 transactions");
    await expect(net(page)).toHaveText("+2.020,51 €");
  });

  await test.step("the period stepper walks back to the month before", async () => {
    await page.goto("/expenses");
    await page.getByRole("link", { name: "Previous period" }).click();
    await expect(page).toHaveURL(/off=1/);
    await expect(page.getByRole("row").filter({ hasText: "Netflix" })).toHaveCount(1);
    await expect(page.getByRole("row").filter({ hasText: "Esselunga" })).toHaveCount(0);
  });

  await test.step("a giroconto stays in the list and out of every total (F2.5)", async () => {
    // Last month also holds one leg of a transfer whose other side is not linked: −500,00 € that
    // left the account but was never spent, so the net is Netflix alone.
    const transfer = page.getByRole("row").filter({ hasText: "Revolut" });
    await expect(transfer).toHaveCount(1);
    await expect(transfer).toContainText("Unpaired transfer");
    // Grey, not red: it left the account but was not spent.
    await expect(transfer.getByText("−500,00 €")).toHaveClass(/text-muted/);
    await expect(summary(page)).toHaveText("2 transactions");
    await expect(net(page)).toHaveText("−12,99 €");
    await expect(page.getByText("1 transfer left out of the totals · 1 has no other leg here")).toBeVisible();

    await page.getByRole("link", { name: /^Transfers/ }).click();
    await expect(page).toHaveURL(/type=transfer/);
    await expect(page.getByRole("row").filter({ hasText: "Netflix" })).toHaveCount(0);
    await expect(page.getByRole("row").filter({ hasText: "Revolut" })).toHaveCount(1);
    await expect(net(page)).toHaveText("0,00 €");
  });

  await test.step("the palette finds a payee and opens Expenses filtered on it", async () => {
    await page.goto("/");
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("combobox", { name: /Search/ });
    await palette.fill("netfl");
    await page.getByRole("option", { name: /Netflix/ }).click();
    await expect(page).toHaveURL(/\/expenses\?q=Netflix/);
    await expect(page.getByRole("row").filter({ hasText: "Netflix" })).toHaveCount(1);
  });
});
