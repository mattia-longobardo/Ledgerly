import { expect, test } from "@playwright/test";
import { hydrated } from "../_shared/helpers";
import { sessionState } from "../_shared/env";

// Release N4b (ux/n4-account-switch.md §2.2, §3, §4): the way into the switch of an account to the
// bank, up to the step "Account". The dry run is not started: it would ask a bank.
test.use({ storageState: sessionState("switchJourney") });
test.describe.configure({ mode: "default" });

test("an account of a source offers the move to the bank, and the step Account shows the bank's same account", async ({
  page,
}) => {
  await page.goto("/accounts");
  await page.getByRole("link", { name: "Conto da passare" }).first().click();
  await page.waitForURL(/\/accounts\/[0-9a-f-]{36}$/);
  const account = new URL(page.url()).pathname;
  await page.goto(`${account}?tab=settings`);
  const move = page.getByRole("link", { name: "Move to the bank" });
  await expect(move).toBeVisible();
  await hydrated(move);
  await move.click();
  await expect(page).toHaveURL(`${account}/switch`);
  await expect(
    page.getByRole("group", { name: "Which account of the bank is “Conto da passare”?" }),
  ).toBeVisible();
  const choice = page.getByRole("radio", { name: /Conto corrente · IT60 •+ ?3456 · EUR/ });
  await expect(choice).toBeChecked();
  await expect(page.getByText("Same IBAN")).toBeVisible();
  // The IBAN is never in the page whole.
  await expect(page.locator("body")).not.toContainText("IT60X0542811101000000123456");

  await page.getByRole("link", { name: "Cancel" }).click();
  await expect(page).toHaveURL(`${account}?tab=settings`);
});

test("another person does not reach the page of the switch", async ({ page, browser }) => {
  await page.goto("/accounts");
  await page.getByRole("link", { name: "Conto da passare" }).first().click();
  await page.waitForURL(/\/accounts\/[0-9a-f-]{36}$/);
  const path = `${new URL(page.url()).pathname}/switch`;
  const context = await browser.newContext({ storageState: sessionState("pockets") });
  const other = await context.newPage();
  // The account of somebody else is an account that does not exist.
  expect((await other.goto(path))?.status()).toBe(404);
  await context.close();
});

/** Decision H58: archiving a double asks first and says, in its Danger zone, that it counts in no month. */
test("archiving an account that doubles another asks first, and its Danger zone says so", async ({
  page,
}) => {
  await page.goto("/accounts");
  await page.getByRole("link", { name: "Conto doppio" }).first().click();
  await page.waitForURL(/\/accounts\/[0-9a-f-]{36}$/);
  const account = new URL(page.url()).pathname;
  await page.goto(`${account}?tab=settings`);
  const archive = page.getByRole("button", { name: "Archive account" });
  await hydrated(archive);

  // Cancel changes nothing.
  await archive.click();
  const dialog = page.getByRole("dialog", { name: "Archive Conto doppio?" });
  await expect(dialog).toContainText("Conto doppio is a double of “Conto gemello”");
  await dialog.getByRole("button", { name: "Keep it" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Restore account" })).toHaveCount(0);

  await archive.click();
  await dialog.getByRole("button", { name: "Archive account" }).click();
  await expect(page.getByRole("region", { name: "Notifications" })).toContainText("Conto doppio archived");
  await expect(
    page.getByText("Archived as a double of “Conto gemello”: its transactions count in no month."),
  ).toBeVisible();

  // Restored, it is an open account again: the next run finds it as the seed left it.
  await page.getByRole("button", { name: "Restore account" }).click();
  await expect(page.getByRole("button", { name: "Archive account" })).toBeVisible();
});
