// tests/e2e/categories/history.spec.ts — the import of another app's history and the category
// selector's top (decision 14A): one test for each state. The `history` user has the default groups
// and, on an account kept by hand, «Locale Comune» suggested as the group Food & Drinks and
// «Negozio Nuovo» with nothing (scripts/seed-e2e/categories.ts, `seedHistory`). Synthetic data only.
//
// The selector's top comes from a model trained on a person's labels, which a seed cannot make sure
// of: the top-3 test answers the one route of the top with three real categories of the person; the
// "no suggestion" test reads the server's own answer.
import { expect, type Page, test } from "@playwright/test";
import { sessionState } from "../_shared/env";

test.use({ storageState: sessionState("history") });
// One story on one user: an import trains the model again, which may move the rows the selector reads.
test.describe.configure({ mode: "serial" });

const EXPENSES = "/expenses?preset=last3Months";
const FINANCE = "/settings/finance";
const HEADER =
  "account;category;currency;amount;ref_currency_amount;type;payment_type;note;date;transfer;payee;labels";
const row = (page: Page, payee: string) => page.getByRole("row").filter({ hasText: payee });

/** A synthetic export: one line per row, in the export's columns. */
function exportOf(rows: string[], header = HEADER) {
  return {
    name: "records.csv",
    mimeType: "text/csv",
    buffer: Buffer.from([header, ...rows].join("\n") + "\n"),
  };
}
const line = (
  category: string,
  type: "Expense" | "Income",
  amount: string,
  payee: string,
  transfer = "false",
) => `Cash;${category};EUR;${amount};${amount};${type};CASH;;2025-03-10T10:00:00.000Z;${transfer};${payee};`;

async function importFile(page: Page, file: ReturnType<typeof exportOf>) {
  await page.goto(FINANCE);
  const section = page.getByRole("region", { name: "Learn from your history" });
  await section.getByLabel("Wallet export (CSV)").setInputFiles(file);
  await section.getByRole("button", { name: "Import" }).click();
  return section;
}

/** The picker of a row's category, opened from the keyboard. */
async function openPicker(page: Page, payee: string) {
  await page.goto(EXPENSES);
  await row(page, payee).getByRole("button", { name: "Edit category" }).focus();
  await page.keyboard.press("Enter");
  return page.getByRole("listbox", { name: "Edit category" });
}

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

test("an import says how many rows it learnt and that no transaction was made", async ({ page }) => {
  const section = await importFile(
    page,
    exportOf([
      line("Groceries", "Expense", "12.50", "Market One"),
      line("Bar, cafe", "Expense", "2.40", "Cafe Two"),
      line("Wage, invoices", "Income", "900.00", "Employer Three"),
      line("", "Expense", "50.00", "Own account", "true"),
      line("Unknown", "Expense", "7.00", "Somewhere"),
    ]),
  );
  const result = section.getByTestId("history-result");
  await expect(result).toContainText("3 rows learnt");
  await expect(result).toContainText("1 transfer left out");
  await expect(result).toContainText("1 row without a category");
  await expect(result).toContainText("No transaction was created.");
  await expect(result).not.toContainText("a category you do not have");
});

test("an import counts the rows whose category the person does not have", async ({ page }) => {
  const section = await importFile(
    page,
    exportOf([
      line("Groceries", "Expense", "12.50", "Market One"),
      line("Invented thing", "Expense", "3.00", "Shop"),
    ]),
  );
  const result = section.getByTestId("history-result");
  await expect(result).toContainText("1 row learnt");
  await expect(result).toContainText("1 row has a category you do not have");
});

test("a file that is not an export is refused, and nothing is learnt", async ({ page }) => {
  const section = await importFile(page, exportOf(["1;2;3"], "date;payee;amount"));
  await expect(section.getByRole("alert")).toHaveText(
    "This is not a Wallet export: the columns do not match.",
  );
  await expect(section.getByTestId("history-result")).toHaveCount(0);
});

test("a file past 5 MB is refused before it travels", async ({ page }) => {
  let sent = false;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/v1/categories/labels")) sent = true;
  });
  const big = { name: "records.csv", mimeType: "text/csv", buffer: Buffer.alloc(5 * 1024 * 1024 + 1, "a") };
  const section = await importFile(page, big);
  await expect(section.getByRole("alert")).toHaveText("The file is larger than 5 MB.");
  expect(sent).toBe(false);
});
