// tests/e2e/transactions/manual-movement.spec.ts — the movement written by hand (rewrite plan N3;
// ux/n3-categories-manual.md §9): the dialog of Expenses, the row with its badge and its own menu,
// and the balance of the account, which follows at once and is the one Accounts shows.
//
// The `manual` user is this spec's own (scripts/seed-e2e.ts): "Contanti", kept by hand, with
// 80,00 € written five days ago and one manual movement of 12,50 € two days ago; "Zeta Bank conto",
// which a bank only reads. Each test puts back what it changes.
import { expect, type Page, test } from "@playwright/test";
import { sessionState } from "../_shared/env";

// The tests of this file change the data of one user, each from what the one before left: they run
// in order, on one worker, while the other files run beside them (playwright.preview.config.ts).
test.describe.configure({ mode: "default" });

test.use({ storageState: sessionState("manual") });

/** The last three months: the seeded movement is two days old, in the month before on a 1st or a 2nd. */
const EXPENSES = "/expenses?preset=last3Months";

const dialog = (page: Page) => page.getByTestId("manual-dialog");
const rowOf = (page: Page, payee: string) => page.getByRole("row").filter({ hasText: payee });

/** The balance of an account as the Accounts page says it, in the row that carries its name. */
async function balanceOf(page: Page, account: string): Promise<string> {
  await page.goto("/accounts");
  const row = page.getByRole("row").filter({ hasText: account }).first();
  await expect(row).toBeVisible();
  return (await row.innerText()).replace(/\s+/g, " ");
}

async function openAdd(page: Page) {
  await page.goto(EXPENSES);
  await page.getByRole("button", { name: "Add transaction" }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByLabel("Account")).toBeEnabled();
}

test("a manual movement is written, changed and deleted, and the balance follows each time", async ({
  page,
}) => {
  await test.step("the seeded manual movement carries its badge, and the balance already holds it", async () => {
    await page.goto(EXPENSES);
    await expect(rowOf(page, "Edicola").getByText("Manual", { exact: true })).toBeVisible();
    // 80,00 − 12,50, the movement the seed wrote by hand.
    expect(await balanceOf(page, "Contanti")).toContain("67,50 €");
  });

  await test.step("the dialog starts on the account kept by hand and says the balance before and after", async () => {
    await openAdd(page);
    await expect(dialog(page).getByLabel("Account")).toHaveValue(/.+/);
    await expect(dialog(page).getByLabel("Account").locator("option:checked")).toHaveText("Contanti");
    await expect(page.getByTestId("manual-bank-warning")).toHaveCount(0);
    await dialog(page).getByLabel("Amount").fill("4,50");
    await dialog(page).getByLabel("Payee (optional)").fill("Bar Centrale");
    await expect(page.getByTestId("manual-balance-line")).toHaveText(
      "Balance of “Contanti”: from 67,50 € to 63,00 €.",
    );
  });

  await test.step("saving closes the dialog, says so, and the row is in the list with its badge", async () => {
    await page.getByRole("button", { name: "Add transaction" }).last().click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByText("Transaction added", { exact: true })).toBeVisible();
    await expect(rowOf(page, "Bar Centrale")).toHaveCount(1);
    await expect(rowOf(page, "Bar Centrale").getByText("Manual", { exact: true })).toBeVisible();
    await expect(rowOf(page, "Bar Centrale")).toContainText("−4,50 €");
    // The header's button has the focus back.
    await expect(page.getByRole("button", { name: "Add transaction" })).toBeFocused();
  });

  await test.step("Accounts shows the new balance at once", async () => {
    expect(await balanceOf(page, "Contanti")).toContain("63,00 €");
  });

  await test.step("the row's menu changes the movement in the same dialog, and the balance is corrected", async () => {
    await page.goto(EXPENSES);
    await rowOf(page, "Bar Centrale").getByRole("button", { name: "Row actions" }).click();
    await page.getByRole("menuitem", { name: "Edit transaction" }).click();
    await expect(page.getByRole("dialog", { name: "Edit transaction" })).toBeVisible();
    await expect(dialog(page).getByLabel("Amount")).toHaveValue("4,50");
    await dialog(page).getByLabel("Amount").fill("10");
    await expect(page.getByTestId("manual-balance-line")).toHaveText(
      "Balance of “Contanti”: from 63,00 € to 57,50 €.",
    );
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Transaction saved", { exact: true })).toBeVisible();
    await expect(rowOf(page, "Bar Centrale")).toContainText("−10,00 €");
    expect(await balanceOf(page, "Contanti")).toContain("57,50 €");
  });

  await test.step("deleting asks first, removes the row for good and gives the balance back", async () => {
    await page.goto(EXPENSES);
    await rowOf(page, "Bar Centrale").getByRole("button", { name: "Row actions" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    const confirm = page.getByRole("dialog", { name: "Delete this transaction?" });
    await expect(confirm).toContainText("You added it by hand on");
    await confirm.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("1 transaction deleted")).toBeVisible();
    await expect(rowOf(page, "Bar Centrale")).toHaveCount(0);
    expect(await balanceOf(page, "Contanti")).toContain("67,50 €");
  });
});

test("an account a bank reads warns about a double, takes the movement and shows the new balance", async ({
  page,
}) => {
  await openAdd(page);
  await dialog(page).getByLabel("Account").selectOption({ label: "Zeta Bank conto" });
  await expect(page.getByTestId("manual-bank-warning")).toContainText(
    "This account gets its transactions from the bank. A transaction added by hand can appear twice.",
  );
  await expect(page.getByTestId("manual-bank-warning")).toContainText(
    "At the next reading the bank's balance applies.",
  );
  await dialog(page).getByLabel("Amount").fill("50");
  await dialog(page).getByLabel("Payee (optional)").fill("Mercato");
  await expect(page.getByTestId("manual-balance-line")).toHaveText(
    "Balance of “Zeta Bank conto”: from 1.000,00 € to 950,00 €.",
  );
  // The warning does not stop the save.
  await page.getByRole("button", { name: "Add transaction" }).last().click();
  await expect(rowOf(page, "Mercato")).toHaveCount(1);
  expect(await balanceOf(page, "Zeta Bank conto")).toContain("950,00 €");

  // Put back: the next run and the other tests start from the bank's own balance.
  await page.goto(EXPENSES);
  await rowOf(page, "Mercato").getByRole("button", { name: "Row actions" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(rowOf(page, "Mercato")).toHaveCount(0);
  expect(await balanceOf(page, "Zeta Bank conto")).toContain("1.000,00 €");
});

test("a day before the last balance written changes nothing, and the dialog says so before the save", async ({
  page,
}) => {
  await openAdd(page);
  const sixDaysAgo = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
  await dialog(page).getByLabel("Date").fill(sixDaysAgo);
  await dialog(page).getByLabel("Amount").fill("3");
  await expect(page.getByTestId("manual-balance-line")).toContainText(
    "already includes this day: it does not change.",
  );
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog(page)).toHaveCount(0);
});

test("an amount that is not one stays in the dialog, with the reason under the field", async ({ page }) => {
  await openAdd(page);
  await page.getByRole("button", { name: "Add transaction" }).last().click();
  await expect(dialog(page).getByText("Enter an amount greater than zero.")).toBeVisible();
  await expect(dialog(page).getByLabel("Amount")).toBeFocused();
  await dialog(page).getByLabel("Amount").fill("0");
  await page.getByRole("button", { name: "Add transaction" }).last().click();
  await expect(dialog(page).getByText("Enter an amount greater than zero.")).toBeVisible();
  await expect(dialog(page)).toBeVisible();
});

test("the dialog works from the keyboard: the palette opens it, Escape closes it", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("Add transaction");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/expenses$/);
  await expect(page.getByRole("dialog", { name: "Add transaction" })).toBeVisible();
  // The amount has the focus: the first thing a person types.
  await expect(dialog(page).getByLabel("Amount")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

for (const { width, height } of [
  { width: 1440, height: 900 },
  { width: 400, height: 860 },
]) {
  test(`the dialog and the row fit the window at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openAdd(page);
    await dialog(page).getByLabel("Account").selectOption({ label: "Zeta Bank conto" });
    await dialog(page).getByLabel("Amount").fill("12,34");
    await expect(page.getByTestId("manual-balance-line")).toBeVisible();
    const popup = await page.getByRole("dialog").boundingBox();
    expect(popup).not.toBeNull();
    expect(popup!.x).toBeGreaterThanOrEqual(0);
    expect(popup!.x + popup!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
