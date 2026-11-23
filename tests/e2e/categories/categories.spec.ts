// tests/e2e/categories/categories.spec.ts — Expenses › Categories (categories-and-rules.md §5, N3.2):
// the three macros with their groups and totals, the page of a category, and the structure changed
// from the row's menu — moving, merging and archiving with "Undo", deleting with what it takes said
// first. Its own user, with no Wallet connection, so nothing here can reach an external account.
import { type Page, expect, test } from "@playwright/test";
import { sessionState } from "../_shared/env";
import { hydrated } from "../_shared/helpers";

test.use({ storageState: sessionState("categories") });

/** A group's row: the item that holds the button named after the group. */
const groupRow = (page: Page, name: string) =>
  page
    .getByRole("listitem")
    .filter({ has: page.getByRole("button", { name, exact: true }) })
    .first();

async function act(page: Page, name: string, item: string) {
  await page.getByRole("button", { name: `Actions for ${name}`, exact: true }).click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
}

async function undo(page: Page) {
  await page.getByRole("button", { name: "Undo" }).last().click();
  await expect(page.getByText("Undone").last()).toBeVisible();
}

test("each macro totals what the header of Expenses says, for the same period", async ({ page }) => {
  await page.goto("/expenses?preset=last3Months");
  const spending = await page
    .locator("dl > div")
    .filter({ has: page.locator("dt", { hasText: /^Spending$/ }) })
    .locator("dd")
    .textContent();
  await page.goto("/expenses/categories?preset=last3Months");
  await expect(page.getByRole("heading", { name: "Categories", level: 1 })).toBeVisible();
  // The three macros, Expenses first.
  for (const macro of ["Income", "Expenses", "Transfers"]) {
    await expect(page.getByRole("button", { name: macro, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Expenses", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("macro-total")).toHaveText(spending ?? "");
  // The movements with no category have their own row, which leads to "To review".
  await expect(page.getByRole("link", { name: "Review", exact: true })).toHaveAttribute(
    "href",
    /\/expenses\/review/,
  );
});

test("a person builds groups, moves, merges and archives with Undo, opens a category and deletes", async ({
  page,
}) => {
  const first = `E2E ${Date.now()}`;
  const second = `${first} two`;
  const a = `${first} a`;
  const b = `${first} b`;

  await test.step("two new groups, closed, each with the colour picked for it", async () => {
    await page.goto("/expenses/categories");
    for (const name of [first, second]) {
      const add = page.getByRole("button", { name: "New group" });
      await hydrated(add);
      await add.click();
      const dialog = page.getByRole("dialog", { name: "New group" });
      await dialog.getByLabel("Name").fill(name);
      await expect(dialog.getByRole("button", { name: "Automatic" })).toHaveAttribute("aria-pressed", "true");
      await dialog.getByRole("button", { name: "Save" }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByRole("button", { name, exact: true })).toHaveAttribute("aria-expanded", "false");
    }
  });

  await test.step("a group opens, and its categories are added under it", async () => {
    await page.getByRole("button", { name: first, exact: true }).click();
    await expect(page.getByRole("button", { name: first, exact: true })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    for (const name of [a, b]) {
      await groupRow(page, first).getByRole("button", { name: "Add a category" }).click();
      const dialog = page.getByRole("dialog", { name: "Add a category" });
      await expect(dialog).toContainText(`In Expenses › ${first}`);
      await dialog.getByLabel("Name").fill(name);
      await dialog.getByRole("button", { name: "Save" }).click();
      await expect(dialog).toBeHidden();
      await expect(groupRow(page, first).getByRole("link", { name, exact: true })).toBeVisible();
    }
  });

  await test.step("a category moves to another group of the macro, and Undo puts it back", async () => {
    await act(page, a, "Move to another group…");
    const dialog = page.getByRole("dialog", { name: "Move to another group…" });
    await dialog.getByLabel("Group").selectOption({ label: second });
    await dialog.getByRole("button", { name: "Move", exact: true }).click();
    await expect(page.getByText(`“${a}” moved to ${second}`)).toBeVisible();
    await expect(groupRow(page, first).getByRole("link", { name: a, exact: true })).toHaveCount(0);
    await undo(page);
    await expect(groupRow(page, first).getByRole("link", { name: a, exact: true })).toBeVisible();
  });

  await test.step("two categories merge into one, and Undo brings the other back", async () => {
    await act(page, b, "Merge with…");
    const dialog = page.getByRole("dialog", { name: "Merge categories" });
    await dialog.getByLabel("The category that stays").selectOption({ label: `${first} › ${a}` });
    await dialog.getByRole("button", { name: "Merge", exact: true }).click();
    await expect(page.getByText(new RegExp(`“${b}” merged into ${a}`))).toBeVisible();
    await expect(page.getByRole("link", { name: b, exact: true })).toHaveCount(0);
    await undo(page);
    await expect(groupRow(page, first).getByRole("link", { name: b, exact: true })).toBeVisible();
  });

  await test.step("archiving a group says its categories go too, and Undo brings all of them back", async () => {
    await act(page, first, "Archive");
    const dialog = page.getByRole("dialog", { name: `Archive “${first}”?` });
    await expect(dialog).toContainText("Its 2 categories are archived too.");
    await dialog.getByRole("button", { name: "Archive", exact: true }).click();
    await expect(page.getByText(`“${first}” archived`)).toBeVisible();
    await expect(page.getByRole("button", { name: first, exact: true })).toHaveCount(0);
    await undo(page);
    await expect(groupRow(page, first).getByRole("link", { name: a, exact: true })).toBeVisible();
    await expect(groupRow(page, first).getByRole("link", { name: b, exact: true })).toBeVisible();
  });

  // N3.3 (categories-and-rules.md §5.6): the macro decides how the movements count.
  await test.step("a group moves to Transfers with its categories, and Undo puts it back", async () => {
    await act(page, first, "Move to another section…");
    const dialog = page.getByRole("dialog", { name: `Move “${first}” to another section` });
    await expect(dialog).toContainText("No transaction counts differently.");
    await dialog.getByRole("button", { name: "Transfers", exact: true }).click();
    await expect(dialog).toContainText("Its 2 categories go to Transfers too.");
    await dialog.getByRole("button", { name: "Move", exact: true }).click();
    await expect(page.getByText(`“${first}” moved to Transfers`)).toBeVisible();
    await expect(page.getByRole("button", { name: first, exact: true })).toHaveCount(0);
    await undo(page);
    await expect(groupRow(page, first).getByRole("link", { name: a, exact: true })).toBeVisible();
  });

  await test.step("a category opens on its own page, with the period of the list", async () => {
    await groupRow(page, first).getByRole("link", { name: a, exact: true }).click();
    await expect(page).toHaveURL(/\/expenses\/categories\/[0-9a-f-]{36}/);
    await expect(page.getByRole("heading", { name: a, level: 1 })).toBeVisible();
    await expect(page.getByText("Spent", { exact: true })).toBeVisible();
    await expect(page.getByText("No transactions in this period")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open in Expenses" })).toHaveAttribute("href", /cat=/);
    await page
      .getByRole("navigation", { name: "Where this category is" })
      .getByRole("link", { name: "Expenses" })
      .click();
    await expect(page).toHaveURL(/\/expenses\/categories(\?|$)/);
  });

  await test.step("deleting says what it takes, Wallet included, and only then takes it", async () => {
    for (const name of [first, second]) {
      await act(page, name, "Delete");
      const dialog = page.getByRole("dialog", { name: "Delete this category?" });
      await expect(dialog).toContainText("cannot be undone");
      await expect(dialog).toContainText("It is deleted at its source too, if it came from one.");
      if (name === first) await expect(dialog).toContainText("Its sub-categories are deleted with it.");
      await dialog.getByRole("button", { name: "Delete" }).click();
      await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
    }
    await expect(page.locator("main").getByText(a, { exact: true })).toHaveCount(0);
  });
});
