// tests/e2e/source-categories.spec.ts — "Categories of {source}" in Settings › Categories (rewrite
// plan N3.1; ux/n3-categories-manual.md §6.4): each category a source gives is matched to a
// category of the person or added as its own, the change counts at once in Expenses, and "Undo"
// takes it back.
//
// The `sources` user is this spec's own (scripts/seed-e2e.ts): four categories of the source —
// "Spesa" and "Alcolici e tabacchi" added, "Tabacchi" matched to "Alcolici e tabacchi", "Animali"
// just arrived. No connection is behind them: nothing here reaches a source. Each test puts back
// what it changes.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { sessionState } from "./env";

test.use({ storageState: sessionState("sources") });

const section = (page: Page) => page.getByTestId("source-categories");
/** The row of one category of the source, in the layout that is on screen. */
const rowOf = (page: Page, name: string): Locator =>
  section(page)
    .getByTestId("source-category-row")
    .locator("visible=true")
    .filter({ hasText: `${name} ·` });
const chooser = (page: Page, name: string): Locator =>
  rowOf(page, name).getByRole("button", { name: `Ledgerly category for “${name}”` });

async function open(page: Page) {
  await page.goto("/settings/categories");
  await expect(section(page)).toBeVisible();
}

async function choose(page: Page, name: string, option: string) {
  await chooser(page, name).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("the section lists the source's categories with what each counts under", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("heading", { name: /^.+ categories$/ })).toBeVisible();
  await expect(rowOf(page, "Spesa")).toContainText("Spesa · 2 transactions");
  await expect(chooser(page, "Spesa")).toContainText("Added as “Spesa”");
  await expect(rowOf(page, "Tabacchi")).toContainText("Tabacchi · 2 transactions");
  await expect(chooser(page, "Tabacchi")).toContainText("Alcolici e tabacchi");
  // The category the two count under says so in the tree.
  await expect(page.getByText(/^From .+: Alcolici e tabacchi, Tabacchi$/)).toBeVisible();

  // The one that has just arrived is marked, and is alone under "New".
  await expect(rowOf(page, "Animali").getByText("New", { exact: true })).toBeVisible();
  await section(page).getByRole("button", { name: "New (1)" }).click();
  await expect(section(page).getByTestId("source-category-row").locator("visible=true")).toHaveCount(1);
  await expect(rowOf(page, "Animali")).toBeVisible();
});

test("a match counts at once in Expenses, and adding the category back puts its movements back", async ({
  page,
}) => {
  await test.step("'Spesa' of the source is matched to another category", async () => {
    await open(page);
    await choose(page, "Spesa", "Alcolici e tabacchi");
    await expect(page.getByText(/^Spesa now matches Alcolici e tabacchi: 2 transactions$/)).toBeVisible();
    await expect(chooser(page, "Spesa")).toContainText("Alcolici e tabacchi");
  });

  await test.step("its movements count under that category, with no mark of a change", async () => {
    await page.goto("/expenses?preset=last3Months");
    const row = page.getByRole("row").filter({ hasText: "Esselunga Superstore" });
    await expect(row).toContainText("Alcolici e tabacchi");
    await expect(row.getByText("Edited here", { exact: true })).toHaveCount(0);
  });

  await test.step("added back as its own category, the movements are under it again", async () => {
    await open(page);
    await choose(page, "Spesa", "Add as a new category");
    await expect(page.getByText(/^Spesa added as a category: 2 transactions$/)).toBeVisible();
    await expect(chooser(page, "Spesa")).toContainText("Added as “Spesa”");
    await page.goto("/expenses?preset=last3Months");
    await expect(page.getByRole("row").filter({ hasText: "Esselunga Superstore" })).toContainText("Spesa");
  });
});

test("'Undo' in the toast takes a match back", async ({ page }) => {
  await open(page);
  await choose(page, "Alcolici e tabacchi", "Spesa");
  await expect(page.getByText(/^Alcolici e tabacchi now matches Spesa: 1 transaction$/)).toBeVisible();
  await expect(chooser(page, "Alcolici e tabacchi")).toContainText("Spesa");

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(chooser(page, "Alcolici e tabacchi")).toContainText("Added as “Alcolici e tabacchi”");
  // What was matched to it before is still matched to it.
  await expect(chooser(page, "Tabacchi")).toContainText("Alcolici e tabacchi");
});

for (const { width, height } of [
  { width: 1440, height: 900 },
  { width: 400, height: 860 },
]) {
  test(`the section fits the window at ${width} px, with a chooser on every row`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await open(page);
    const rows = section(page).getByTestId("source-category-row").locator("visible=true");
    await expect(rows).toHaveCount(4);
    for (const name of ["Spesa", "Tabacchi", "Alcolici e tabacchi", "Animali"]) {
      const box = await chooser(page, name).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
