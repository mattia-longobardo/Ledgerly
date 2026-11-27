// tests/e2e/investments/plans.spec.ts — the basket purchase plans of a manual portfolio
// (docs/design/investments-plans-whole-shares.md §7, §8.2): one test per state of the screen. The
// figures are the server's: the proposal of the seed is example 1, run 1 of the design, the skipped
// line example 2; a correction asks the server's preview; a discard passes the whole budget on (D2);
// fees are outside the amount (D1). The client computes none of them.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { sessionState } from "../_shared/env";

// Its own user (scripts/seed-e2e/investments.ts, seedPlans): «Piani», «Senza liquidità», «Vuoto».
test.use({ storageState: sessionState("plansJourney") });
test.describe.configure({ mode: "serial" });

/** An amount as the screens write it, in either separator. */
const money = (amount: string) => new RegExp(amount.replace(".", "[.,]"));

async function openPlans(page: Page, portfolio: string): Promise<void> {
  await page.goto("/investments");
  const link = page.getByRole("link", { name: portfolio, exact: true }).filter({ visible: true }).first();
  await page.goto(`${await link.getAttribute("href")}/plans`);
  await expect(page.getByRole("heading", { name: portfolio, level: 1 })).toBeVisible();
}

const planRow = (page: Page, name: string): Locator =>
  page.getByTestId("plans-table").getByRole("row").filter({ hasText: name });

/** The executions shown: the table's rows at this width. */
const runs = (page: Page): Locator => page.getByTestId("plan-run").filter({ visible: true });

async function choosePlan(page: Page, name: string): Promise<void> {
  await page
    .getByTestId("plans-table")
    .getByRole("link", { name: new RegExp(`^${name}`) })
    .click();
  await expect(page.getByRole("heading", { name: `Executions · ${name}` })).toBeVisible();
}

/** «Review» of the plan's open proposal, and its dialog once the server's preview answered. */
async function review(page: Page, plan: string): Promise<Locator> {
  await choosePlan(page, plan);
  await runs(page)
    .first()
    .getByRole("button", { name: /^Review the proposal of/ })
    .click();
  const dialog = page.getByRole("dialog", { name: new RegExp(`^Review the proposal of .* · ${plan}$`) });
  await expect(dialog.getByTestId("review-carry")).not.toContainText("…");
  return dialog;
}

const shares = (dialog: Locator, name: string) => dialog.getByLabel(`Shares of ${name}`);

/** Picks an instrument of the registry in the plan's form and adds it to the basket. */
async function addInstrument(dialog: Locator, isin: string): Promise<void> {
  await dialog.getByRole("searchbox", { name: "Instrument" }).fill(isin);
  await dialog.getByTestId("instrument-hit").first().click();
  await dialog.getByRole("button", { name: "Add instrument" }).click();
}

test("empty: a portfolio with no plan says so, and «New plan» opens the form", async ({ page }) => {
  await openPlans(page, "Vuoto");
  await expect(page.getByText("No purchase plan yet")).toBeVisible();
  await page.getByRole("button", { name: "New plan" }).click();
  await expect(page.getByRole("dialog", { name: "New purchase plan · Vuoto" })).toBeVisible();
});

test("form error: percentages of 60 and 30 are refused with the sum's message", async ({ page }) => {
  await openPlans(page, "Piani");
  await page.getByRole("button", { name: "New plan" }).click();
  const dialog = page.getByRole("dialog", { name: "New purchase plan · Piani" });
  await dialog.getByLabel("Name").fill("Piano sbagliato");
  await dialog.getByLabel("Amount of each execution").fill("100");
  await addInstrument(dialog, "US5949181045");
  await addInstrument(dialog, "US02079K3059");
  await dialog.getByLabel("Percentage of Alfa World ETF").fill("60");
  await dialog.getByLabel("Percentage of Beta Bond ETF").fill("30");
  await dialog.getByLabel("Day of the month").fill("10");
  await expect(dialog.getByTestId("weights-sum")).toContainText("Total 90 %");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog.getByRole("alert")).toContainText("The percentages must make 100 %");
  await expect(dialog).toBeVisible();
});

test("active plan: a plan of 2 instruments shows its percentages, amount, cadence and next date", async ({
  page,
}) => {
  await openPlans(page, "Piani");
  await page.getByRole("button", { name: "New plan" }).click();
  const dialog = page.getByRole("dialog", { name: "New purchase plan · Piani" });
  await dialog.getByLabel("Name").fill("PAC mensile");
  await dialog.getByLabel("Amount of each execution").fill("150");
  await addInstrument(dialog, "US5949181045");
  await addInstrument(dialog, "US02079K3059");
  await dialog.getByLabel("Percentage of Alfa World ETF").fill("60");
  await dialog.getByLabel("Percentage of Beta Bond ETF").fill("40");
  await dialog.getByLabel("Day of the month").fill("10");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog).toBeHidden();
  const row = planRow(page, "PAC mensile");
  await expect(row).toContainText("Alfa World ETF 60 % · Beta Bond ETF 40 %");
  await expect(row).toContainText(money("150.00"));
  await expect(row).toContainText("every month on day 10");
  await expect(row).toContainText(/\d{1,2} \w{3} \d{4}/);
});

test("to complete: «To do» opens the converted plan, and its amount saved clears the warning", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "A purchase plan has no amount yet. Type it." }).click();
  await expect(page).toHaveURL(/\/investments\/[0-9a-f-]+\/plans/);
  const row = planRow(page, "Convertito");
  await expect(row).toContainText("Amount to type");
  await row.getByRole("button", { name: "Set the amount of Convertito" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit Convertito" });
  await dialog.getByLabel("Amount of each execution").fill("50");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(row).not.toContainText("Amount to type");
  await expect(row).toContainText(money("50.00"));
});

test("proposal: the shares and the carry are the design's example 1, run 1; a share too dear is skipped", async ({
  page,
}) => {
  await openPlans(page, "Piani");
  let dialog = await review(page, "Tre ETF");
  await expect(shares(dialog, "Alfa World ETF")).toHaveValue("2");
  await expect(shares(dialog, "Beta Bond ETF")).toHaveValue("3");
  await expect(shares(dialog, "Gamma Gold ETC")).toHaveValue("4");
  await expect(dialog.getByTestId("review-budget")).toContainText(money("200.00"));
  await expect(dialog.getByTestId("review-spentTotal")).toContainText(money("175.25"));
  await expect(dialog.getByTestId("review-carry")).toContainText(money("24.75"));
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // Example 2, run 1: Epsilon's 30 € buy no share at 38 €.
  dialog = await review(page, "Due ETF");
  const epsilon = dialog.getByTestId("review-line").filter({ hasText: "Epsilon EM ETF" });
  await expect(epsilon).toContainText("Skipped: one share costs more than its part");
  await expect(shares(dialog, "Delta Europe ETF")).toHaveValue("1");
  await expect(shares(dialog, "Epsilon EM ETF")).toHaveValue("0");
  await expect(dialog.getByTestId("review-carry")).toContainText(money("45.00"));
});

test("modify: a price typed gives the shares and the carry of the server's preview", async ({ page }) => {
  await openPlans(page, "Piani");
  const dialog = await review(page, "Tre ETF");
  await dialog.getByLabel("Unit price of Alfa World ETF").fill("30");
  // 100 € at 30 €: 3 shares, 90 €; the others stay as proposed.
  await expect(shares(dialog, "Alfa World ETF")).toHaveValue("3");
  await expect(dialog.getByTestId("review-spentTotal")).toContainText(money("182.65"));
  await expect(dialog.getByTestId("review-carry")).toContainText(money("17.35"));
});

test("price missing: the line to type blocks «Confirm» until its price is there; another waits", async ({
  page,
}) => {
  await openPlans(page, "Piani");
  const dialog = await review(page, "Prezzo mancante");
  const zeta = dialog.getByTestId("review-line").filter({ hasText: "Zeta Small Cap ETF" });
  await expect(zeta).toContainText("Price to type");
  const confirm = dialog.getByRole("button", { name: "Confirm", exact: true });
  await expect(confirm).toBeDisabled();
  await expect(dialog.getByTestId("review-blocked")).toBeVisible();
  await dialog.getByLabel("Unit price of Zeta Small Cap ETF").fill("20");
  await expect(shares(dialog, "Zeta Small Cap ETF")).toHaveValue("2");
  await expect(confirm).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await choosePlan(page, "In attesa");
  await expect(runs(page).first()).toHaveAttribute("data-state", "waiting_price");
  await expect(runs(page).first()).toContainText("Prices not available yet: new try tomorrow.");
});

test("cash error: with no cash «Confirm» is refused, offers a deposit, and writes nothing", async ({
  page,
}) => {
  await openPlans(page, "Senza liquidità");
  const dialog = await review(page, "Senza cassa");
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Not enough cash on that day");
  await expect(dialog.getByRole("button", { name: "Record a deposit" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(runs(page).first()).toHaveAttribute("data-state", "proposed");
  await page.getByRole("link", { name: "Activity", exact: true }).click();
  await expect(page.getByText("Alfa World ETF")).toHaveCount(0);
});

test("confirmed: «Confirm» records two purchases, shown in Activity, and the plan shows its carry", async ({
  page,
}) => {
  await openPlans(page, "Piani");
  const dialog = await review(page, "Da confermare");
  // 100 € each: 2 × 41,30 and 5 × 18,75 = 176,35 €; 23,65 € to the next.
  await expect(dialog.getByTestId("review-carry")).toContainText(money("23.65"));
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(dialog).toBeHidden();
  const run = runs(page).first();
  await expect(run).toHaveAttribute("data-state", "recorded");
  await expect(run).toContainText("Recorded");
  await expect(run.getByTestId("run-budget")).toContainText(money("23.65"));
  await expect(planRow(page, "Da confermare")).toContainText(money("23.65"));

  await run.getByRole("link", { name: "See the operations in Activity" }).click();
  const bought = page
    .locator('[data-testid="activity-row"], [data-testid="activity-item"]')
    .filter({ visible: true });
  await expect(bought.filter({ hasText: "Alfa World ETF" })).toHaveCount(1);
  await expect(bought.filter({ hasText: "Beta Bond ETF" })).toHaveCount(1);
});

test("discarded: «Discard» closes the execution and passes its whole budget on", async ({ page }) => {
  await openPlans(page, "Piani");
  await choosePlan(page, "Due ETF");
  const run = runs(page).first();
  await run.getByRole("button", { name: /^Discard the execution of/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Discard", exact: true }).click();
  await expect(run).toHaveAttribute("data-state", "skipped");
  await expect(run).toContainText("Discarded");
  await expect(run.getByTestId("run-budget")).toContainText(/Budget .*100[.,]00.* · to the next .*100[.,]00/);
});

test.describe("below md", () => {
  test.use({ viewport: { width: 400, height: 860 } });

  test("the plans are a list with the same commands", async ({ page }) => {
    await openPlans(page, "Piani");
    await expect(page.getByTestId("plans-table")).toBeHidden();
    const list = page.getByTestId("plans-list");
    await expect(list).toBeVisible();
    await expect(list.getByRole("button", { name: "Commands of Tre ETF" })).toBeVisible();
    await expect(list.getByRole("button", { name: "Set the amount of Convertito" })).toHaveCount(0);
  });
});
