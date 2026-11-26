// tests/e2e/categories/history.spec.ts — the category selector's top and the group suggestion
// (decision 14A): one test for each state. The import of another app's history is a command of the
// worker, run once by the release (no screen). The `history` and `suggestions` users have
// the default groups and, on an account kept by hand, «Locale Comune» suggested as the group Food &
// Drinks and «Negozio Nuovo» with nothing (scripts/seed-e2e/categories.ts, `seedHistory`). Synthetic
// data only. `suggestions` is only read: a write trains the model again, and its pass would take
// the seeded suggestion away; `history` chooses.
//
// The selector's top comes from a model trained on a person's labels, which a seed cannot make sure
// of: the top-3 test answers the one route of the top with three real categories of the person; the
// "no suggestion" test reads the server's own answer.
import { expect, type Page, test } from "@playwright/test";
import { sessionState } from "../_shared/env";

test.use({ storageState: sessionState("history") });
// One story on one user: a choice trains the model again, which may move the rows the selector reads.
test.describe.configure({ mode: "serial" });

const EXPENSES = "/expenses?preset=last3Months";
const row = (page: Page, payee: string) => page.getByRole("row").filter({ hasText: payee });

/** The picker of a row's category, opened from the keyboard. */
async function openPicker(page: Page, payee: string) {
  await page.goto(EXPENSES);
  await row(page, payee).getByRole("button", { name: "Edit category" }).focus();
  await page.keyboard.press("Enter");
  return page.getByRole("listbox", { name: "Edit category" });
}

test.describe("read only", () => {
  test.use({ storageState: sessionState("suggestions") });

  test("a group suggestion says to choose the sub-category", async ({ page }) => {
    await page.goto(EXPENSES);
    await row(page, "Locale Comune").getByTestId("suggestion-chip").click();
    const popup = page.getByRole("dialog", { name: "Suggestion" });
    await expect(popup).toContainText("Food & Drinks");
    await expect(popup).toContainText("Probably Food & Drinks: choose the sub-category.");
  });

  test("with no suggestion the selector lists the tree alone", async ({ page }) => {
    const answer = page.waitForResponse(/\/category-suggestions$/);
    const list = await openPicker(page, "Negozio Nuovo");
    expect(await (await answer).json()).toMatchObject({ categoryId: null, top: [] });
    await expect(list.getByRole("option", { name: "Groceries" })).toBeVisible();
    await expect(list.getByRole("group", { name: "Most likely" })).toHaveCount(0);
  });
});

test("the three likeliest categories are on top of the selector, the likeliest picked by Enter", async ({
  page,
}) => {
  const { categories } = await (await page.request.get("/api/v1/categories")).json();
  const idOf = (name: string) => categories.find((one: { name: string }) => one.name === name).id;
  const top = ["Groceries", "Restaurant, fast-food", "Bar, cafe"].map(idOf);
  await page.route("**/api/v1/transactions/*/category-suggestions", (route) =>
    route.fulfill({ json: { categoryId: null, top } }),
  );
  const list = await openPicker(page, "Negozio Nuovo");
  const likely = list.getByRole("group", { name: "Most likely" });
  await expect(likely.getByRole("option")).toHaveText(["Groceries", "Restaurant, fast-food", "Bar, cafe"]);
  // A search leaves the top out: it lists what matches, in the tree.
  await page.keyboard.type("bar");
  await expect(likely).toHaveCount(0);
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Backspace");
  await expect(likely.getByRole("option")).toHaveCount(3);
  await page.keyboard.press("Enter");
  await expect(row(page, "Negozio Nuovo")).toContainText("Groceries");
});
