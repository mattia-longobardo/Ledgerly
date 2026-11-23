// tests/e2e/investments/plans.spec.ts — the purchase plans of a manual portfolio at 1440 px (rewrite plan
// R5d, step 2): «Da fare» opens the plans of the portfolio; an instalment with no cash asks for a
// deposit (P2) and then goes through; an instalment is confirmed and its bank transaction linked (E7),
// another is skipped; past instalments are recorded together (P4), and refused before a «Switch to
// positions»; a plan is created, changed and paused. The figures are the API's: the client computes
// none of them.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { sessionState } from "../_shared/env";
import { TODAY } from "../_shared/helpers";

// Its own user: «Piani» and «Senza liquidità», each with an instalment of today proposed
// (scripts/seed-e2e/investments.ts, seedPlans).
test.use({ storageState: sessionState("plansJourney") });
test.describe.configure({ mode: "serial" });

/** A day before today: a due date of the weekly plans, which fall on today's weekday. */
function daysAgo(days: number): string {
  const day = new Date(`${TODAY}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() - days);
  return day.toISOString().slice(0, 10);
}

/** A day as the screens write it in English: «2 Nov 2026». */
const longDate = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

async function openPlans(page: Page, portfolio: string): Promise<void> {
  await page.goto("/investments");
  const link = page.getByRole("link", { name: portfolio, exact: true }).filter({ visible: true }).first();
  await page.goto(`${await link.getAttribute("href")}/plans`);
  await expect(page.getByRole("heading", { name: portfolio, level: 1 })).toBeVisible();
}

/** The instalments shown: the table's rows at this width. */
const runs = (page: Page): Locator => page.getByTestId("plan-run").filter({ visible: true });

async function choosePlan(page: Page, name: string): Promise<void> {
  await page
    .getByTestId("plans-table")
    .getByRole("link", { name: new RegExp(`^${name}`) })
    .click();
  await expect(page.getByRole("heading", { name: `Instalments · ${name}` })).toBeVisible();
}

async function planCommand(page: Page, name: string, command: string): Promise<void> {
  await page
    .getByTestId("plans-table")
    .getByRole("button", { name: `Commands of ${name}` })
    .click();
  await page.getByRole("menuitem", { name: command, exact: true }).click();
}

test("«Da fare» opens the plans; an instalment with no cash asks for a deposit, then goes through", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: /has no cash\. Record a deposit, then confirm it\./ }).click();
  await expect(page).toHaveURL(/\/investments\/[0-9a-f-]+\/plans$/);
  await expect(page.getByRole("heading", { name: "Senza liquidità", level: 1 })).toBeVisible();
  const run = runs(page).first();
  await expect(run.getByTestId("run-reason")).toContainText("Not enough cash");

  await run.getByRole("button", { name: /^Confirm the instalment of/ }).click();
  const confirm = page.getByRole("dialog", { name: /^Confirm the instalment of/ });
  // The form is the proposal of the server, filled in.
  await expect(confirm.getByLabel("Unit price")).not.toHaveValue("");
  await confirm.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(confirm.getByRole("alert")).toContainText("Not enough cash on that day");
  await confirm.getByRole("button", { name: "Record a deposit" }).click();

  const deposit = page.getByRole("dialog", { name: "Record operation · Senza liquidità" });
  await expect(deposit.getByLabel("Type")).toHaveValue("deposit");
  await expect(deposit.getByLabel("Date")).toHaveValue(TODAY);
  await deposit.getByLabel("Amount").fill("500");
  await deposit.getByRole("button", { name: "Save" }).click();
  await expect(deposit).toBeHidden();

  await run.getByRole("button", { name: /^Confirm the instalment of/ }).click();
  await confirm.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(runs(page).first()).toHaveAttribute("data-state", "recorded");
});

test("an instalment is confirmed and its bank transaction linked; another is skipped", async ({ page }) => {
  await openPlans(page, "Piani");
  await choosePlan(page, "ETF settimanale");
  const run = runs(page).first();
  await expect(run).toContainText("Found:");
  // Each figure in its currency: the asset's and the bank account's.
  await expect(run).toContainText("€");
  await run.getByRole("button", { name: /^Confirm the instalment of/ }).click();
  const confirm = page.getByRole("dialog", { name: /^Confirm the instalment of/ });
  await confirm.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(run).toHaveAttribute("data-state", "recorded");

  await run.getByRole("button", { name: /^Link the transaction of the instalment/ }).click();
  const link = page.getByRole("dialog", { name: "Link the bank transaction?" });
  await link.getByRole("button", { name: "Link", exact: true }).click();
  await expect(link).toBeHidden();
  await expect(run).toContainText("Linked:");

  await choosePlan(page, "ETF da saltare");
  const other = runs(page).first();
  await other.getByRole("button", { name: /^Skip the instalment of/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Skip", exact: true }).click();
  await expect(other).toHaveAttribute("data-state", "skipped");
});

// The server lists the past due dates with their proposal (P4); a portfolio made today takes past
// purchases, and they are written all together.
test("«Record the past instalments» proposes every past due date and records them together", async ({
  page,
}) => {
  await openPlans(page, "Piani");
  await planCommand(page, "ETF settimanale", "Record the past instalments");
  const dialog = page.getByRole("dialog", { name: "Record the past instalments · ETF settimanale" });
  const rows = dialog.getByTestId("backfill-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText(`Due date ${longDate(daysAgo(21))}`);
  await expect(rows.first().getByLabel("Unit price")).not.toHaveValue("");
  await expect(dialog.getByTestId("backfill-more")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Record 3 instalments" }).click();
  await expect(dialog).toBeHidden();
  await choosePlan(page, "ETF settimanale");
  await expect(runs(page)).toHaveCount(4);
  await expect(runs(page).nth(3)).toHaveAttribute("data-state", "recorded");
});

test("a past purchase before «Switch to positions» is refused: the days before were a value only", async ({
  page,
}) => {
  await openPlans(page, "Titoli a valore");
  await planCommand(page, "ETF dopo il passaggio", "Record the past instalments");
  const dialog = page.getByRole("dialog", { name: "Record the past instalments · ETF dopo il passaggio" });
  const first = dialog.getByTestId("backfill-row").first();
  await first.getByLabel("Day of the purchase").fill(daysAgo(14));
  await dialog.getByRole("button", { name: /^Record \d+ instalments?$/ }).click();
  await expect(dialog.getByRole("alert")).toContainText("Before that date the portfolio had its value only");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(runs(page)).toHaveCount(1);
});

test("a new plan, changed to automatic, then paused", async ({ page }) => {
  await openPlans(page, "Piani");
  await page.getByRole("button", { name: "New plan" }).click();
  const dialog = page.getByRole("dialog", { name: "New purchase plan · Piani" });
  await dialog.getByLabel("Name").fill("PAC mensile");
  await dialog.getByRole("searchbox", { name: "Instrument" }).fill("IE00BK5BQT80");
  await dialog.getByTestId("instrument-hit").first().click();
  // Fractions are on by default (P3).
  await expect(dialog.getByLabel("Buy fractions of a unit")).toBeChecked();
  await dialog.getByLabel("Amount").fill("50");
  await dialog.getByLabel("Day of the month").fill("10");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog).toBeHidden();
  const plan = page.getByTestId("plans-table").getByRole("row").filter({ hasText: "PAC mensile" });
  await expect(plan).toContainText("To confirm");
  await expect(plan).toContainText("every month on day 10");

  await planCommand(page, "PAC mensile", "Edit");
  const edit = page.getByRole("dialog", { name: "Edit PAC mensile" });
  await edit
    .getByRole("radio", { name: "Automatic" })
    .or(edit.getByRole("button", { name: "Automatic" }))
    .click();
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(edit).toBeHidden();
  await expect(plan).toContainText("Automatic");

  await planCommand(page, "PAC mensile", "Pause");
  await expect(plan).toContainText("Paused");
});
