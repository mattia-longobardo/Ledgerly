// tests/e2e/investments/portfolio.spec.ts — the manual portfolio at 1440 px (rewrite plan R5d): a portfolio
// made from «Add investment», a purchase refused for lack of cash that «Record a deposit» puts right, a
// purchase, a sale of more than is held refused, and «Switch to positions» on a service kept by value.
// The figures are the API's: the client computes none of them.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { sessionState } from "../_shared/env";
import { TODAY } from "../_shared/helpers";

// Its own user: «Titoli» kept by value and nothing else (scripts/seed-e2e/investments.ts).
test.use({ storageState: sessionState("portfolioJourney") });
test.describe.configure({ mode: "serial" });

/** The instrument of the seed, known to the registry: the search asks no register. */
const ISIN = "IE00BK5BQT80";

async function openRecord(page: Page, name: string): Promise<Locator> {
  await page.getByRole("button", { name: "Record operation" }).click();
  const dialog = page.getByRole("dialog", { name: `Record operation · ${name}` });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function pickInstrument(dialog: Locator): Promise<void> {
  await dialog.getByRole("searchbox", { name: "Instrument" }).fill(ISIN);
  await dialog.getByTestId("instrument-hit").first().click();
  await expect(dialog.getByLabel("Market of the order")).toHaveValue("XMIL");
}

async function openTab(page: Page, name: "Overview" | "Positions") {
  const tabs = page.getByRole("navigation", { name: "Sections of the service" });
  await tabs.getByRole("link", { name }).click();
  await expect(tabs.getByRole("link", { name })).toHaveAttribute("aria-current", "page");
}

test("a manual portfolio: cash first, a purchase, no sale of more than is held", async ({ page }) => {
  await test.step("«Add investment» makes a manual portfolio on a new account", async () => {
    await page.goto("/investments");
    await page.getByRole("button", { name: "Add investment" }).first().click();
    await page
      .getByRole("dialog", { name: "Add investment" })
      .getByRole("button", { name: /^Manual portfolio/ })
      .click();
    const dialog = page.getByRole("dialog", { name: "Manual portfolio" });
    // No value to type: the value is the cash and the positions.
    await expect(dialog.getByLabel("Value today")).toHaveCount(0);
    await dialog.getByLabel("Name").fill("Nuovo");
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("heading", { name: "Nuovo", level: 1 })).toBeVisible();
  });

  await test.step("a purchase with no cash is refused, and «Record a deposit» keeps its day", async () => {
    const dialog = await openRecord(page, "Nuovo");
    await expect(dialog.getByLabel("Type")).toHaveValue("buy");
    await pickInstrument(dialog);
    await dialog.getByLabel("Quantity").fill("2");
    await dialog.getByLabel("Unit price").fill("100");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Not enough cash on that day");
    await dialog.getByRole("button", { name: "Record a deposit" }).click();
    await expect(dialog.getByLabel("Type")).toHaveValue("deposit");
    await expect(dialog.getByLabel("Date")).toHaveValue(TODAY);
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await dialog.getByLabel("Amount").fill("1000");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
  });

  await test.step("the purchase goes through: the position and the cash are the API's", async () => {
    const dialog = await openRecord(page, "Nuovo");
    await pickInstrument(dialog);
    await dialog.getByLabel("Quantity").fill("2");
    await dialog.getByLabel("Unit price").fill("100");
    await dialog.getByLabel("Fee").fill("1");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await openTab(page, "Positions");
    const row = page.getByTestId("open-row").filter({ hasText: "Vanguard" });
    await expect(row).toBeVisible();
    await expect(row.getByTestId("price-mode")).toContainText(/(Automatic|Manual) price/);
    await expect(row.getByRole("switch", { name: /^Automatic price · Vanguard/ })).toBeVisible();
    await expect(page.getByTestId("cash-row")).toContainText("799,00");
  });

  await test.step("a sale of more than is held is refused", async () => {
    const dialog = await openRecord(page, "Nuovo");
    await dialog.getByLabel("Type").selectOption("sell");
    const position = dialog.getByLabel("Position");
    await position.selectOption({ index: 1 });
    await dialog.getByLabel("Quantity").fill("5");
    await dialog.getByLabel("Unit price").fill("100");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByRole("alert")).toContainText("You cannot sell more than you hold");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
});

test("«Switch to positions»: a service kept by value keeps its value as positions and cash", async ({
  page,
}) => {
  await page.goto("/investments");
  const link = page.getByRole("link", { name: "Titoli", exact: true }).filter({ visible: true }).first();
  await page.goto((await link.getAttribute("href"))!);
  await expect(page.getByRole("heading", { name: "Titoli", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "More actions" }).first().click();
  await page.getByRole("menuitem", { name: "Switch to positions", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Switch to positions · Titoli" });
  const position = dialog.getByTestId("conversion-position");
  await position.getByRole("searchbox", { name: "Instrument" }).fill(ISIN);
  await position.getByTestId("instrument-hit").first().click();
  await position.getByLabel("Quantity").fill("10");
  await position.getByLabel("Unit price").fill("100");
  await dialog.getByRole("button", { name: "Switch", exact: true }).click();
  await expect(dialog).toBeHidden();
  // A portfolio now: «Record operation» in place of «Update value», and a Positions tab.
  await expect(page.getByRole("button", { name: "Record operation" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Update value" })).toHaveCount(0);
  await openTab(page, "Positions");
  await expect(page.getByTestId("open-row").filter({ hasText: "Vanguard" })).toBeVisible();
  await expect(page.getByTestId("cash-row")).toContainText("2.000,00");
});
