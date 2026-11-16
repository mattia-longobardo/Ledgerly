// tests/e2e/manual-send.spec.ts — a manual movement on an account whose source takes it (rewrite
// plan N3.1; ux/n3-categories-manual.md §9.8): the dialog offers the account under the name of its
// source, the row says "To send" or "Not sent", and the balance follows at once.
//
// The `sources` user is this spec's own (scripts/seed-e2e.ts): "Conto corrente app", an account of
// a source with 500,00 € read yesterday, one manual movement that waits ("Bar Centrale", 4,50 €,
// today) and one the source did not take ("Edicola", 2,00 €, yesterday): 493,50 € in all. The account has no
// connection behind it: nothing in this spec is sent anywhere, "Retry sending" included. Each test
// puts back what it changes.
import { expect, type Page, test } from "@playwright/test";
import { sessionState } from "./env";

// The tests of this file change the data of one user, each from what the one before left: they run
// in order, on one worker, while the other files run beside them (playwright.preview.config.ts).
test.describe.configure({ mode: "default" });

test.use({ storageState: sessionState("sources") });

const EXPENSES = "/expenses?preset=last3Months";
const ACCOUNT = "Conto corrente app";

const dialog = (page: Page) => page.getByTestId("manual-dialog");
const rowOf = (page: Page, payee: string) => page.getByRole("row").filter({ hasText: payee });

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

test("the rows of the movements on their way say where they stand, and the balance holds them", async ({
  page,
}) => {
  await page.goto(EXPENSES);
  const waiting = rowOf(page, "Bar Centrale");
  await expect(waiting.getByText("Manual", { exact: true })).toBeVisible();
  await expect(waiting.getByText("To send", { exact: true })).toBeVisible();
  const refused = rowOf(page, "Edicola");
  await expect(refused.getByText("Manual", { exact: true })).toBeVisible();
  await expect(refused.getByText(/^Not sent to .+/)).toBeVisible();
  // A movement of the source itself carries neither.
  await expect(rowOf(page, "Zoo Market").getByText("Manual", { exact: true })).toHaveCount(0);

  // 500,00 read yesterday, less the two movements written after that reading.
  expect(await balanceOf(page, ACCOUNT)).toContain("493,50 €");
});

test("'Retry sending' is offered on a movement the source did not take, and only there", async ({ page }) => {
  await page.goto(EXPENSES);
  await rowOf(page, "Bar Centrale").getByRole("button", { name: "Row actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Edit transaction" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Retry sending" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await rowOf(page, "Edicola").getByRole("button", { name: "Row actions" }).click();
  await page.getByRole("menuitem", { name: "Retry sending" }).click();
  // No source is connected for this user: the movement stays as it is, and stays here.
  await expect(rowOf(page, "Edicola").getByText(/^Not sent to .+/)).toBeVisible();
  await expect(rowOf(page, "Edicola")).toHaveCount(1);
});

test("the dialog offers the account under its source, says when the movement goes, and the balance follows", async ({
  page,
}) => {
  await test.step("the account is in the group of its source, with the note under it", async () => {
    await openAdd(page);
    const account = dialog(page).getByLabel("Account");
    await expect(account.locator("optgroup")).toHaveCount(2);
    await expect(account.locator("optgroup").nth(1)).toHaveAttribute("label", /^Accounts connected to .+/);
    await account.selectOption({ label: ACCOUNT });
    // Nothing updates this account now: the note says the movement waits for the connection.
    await expect(page.getByTestId("manual-send-note")).toContainText("Ledgerly sends this transaction when");
    await expect(page.getByTestId("manual-bank-warning")).toHaveCount(0);
    await dialog(page).getByLabel("Amount").fill("10");
    await dialog(page).getByLabel("Payee (optional)").fill("Forno Antico");
    await expect(page.getByTestId("manual-balance-line")).toHaveText(
      `Balance of “${ACCOUNT}”: from 493,50 € to 483,50 €.`,
    );
  });

  await test.step("saved, the row waits for its source and the balance has changed at once", async () => {
    await page.getByRole("button", { name: "Add transaction" }).last().click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByText("Transaction added", { exact: true })).toBeVisible();
    await expect(rowOf(page, "Forno Antico").getByText("To send", { exact: true })).toBeVisible();
    expect(await balanceOf(page, ACCOUNT)).toContain("483,50 €");
  });

  await test.step("while it waits it is deleted like every manual movement, and the balance comes back", async () => {
    await page.goto(EXPENSES);
    await rowOf(page, "Forno Antico").getByRole("button", { name: "Row actions" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page
      .getByRole("dialog", { name: "Delete this transaction?" })
      .getByRole("button", { name: "Delete" })
      .click();
    await expect(page.getByText("1 transaction deleted")).toBeVisible();
    await expect(rowOf(page, "Forno Antico")).toHaveCount(0);
    expect(await balanceOf(page, ACCOUNT)).toContain("493,50 €");
  });
});

for (const { width, height } of [
  { width: 1440, height: 900 },
  { width: 400, height: 860 },
]) {
  test(`the dialog with its note and the rows with their state fit the window at ${width} px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto(EXPENSES);
    await expect(page.getByText("To send", { exact: true }).locator("visible=true").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

    await page
      .getByRole("button", { name: /^(Add transaction|Add)$/ })
      .first()
      .click();
    await expect(dialog(page).getByLabel("Account")).toBeEnabled();
    await dialog(page).getByLabel("Account").selectOption({ label: ACCOUNT });
    await expect(page.getByTestId("manual-send-note")).toBeVisible();
    const popup = await page.getByRole("dialog").boundingBox();
    expect(popup).not.toBeNull();
    expect(popup!.x).toBeGreaterThanOrEqual(0);
    expect(popup!.x + popup!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
