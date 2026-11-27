// tests/e2e/accounts/before-opening.spec.ts — a movement dated before the opening of an account «a
// mano» (PERS-678): the import says it, the account's page says it, and «Move the opening» makes the
// balance count it. The balance never moves by itself.
//
// The `beforeOpening` user is this spec's own (scripts/seed-e2e/accounts.ts): «Contanti», kept by
// hand, with its opening of 80,00 € five days ago and nothing else.
import { expect, type Page, test } from "@playwright/test";
import { sessionState } from "../_shared/env";
import { hydrated, TODAY } from "../_shared/helpers";

test.use({ storageState: sessionState("beforeOpening") });

// One story: the import leaves the movement before the opening, the banner moves the opening.
test.describe.configure({ mode: "serial" });

/** `TODAY` moved by `days`, as the CSV file writes a day: DD/MM/YYYY. */
function csvDay(days: number): string {
  const day = new Date(`${TODAY}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10).split("-").reverse().join("/");
}

async function openAccount(page: Page) {
  await page.goto("/accounts");
  await page.getByRole("row").filter({ hasText: "Contanti" }).first().getByRole("link").first().click();
  await expect(page.getByRole("heading", { name: "Contanti" })).toBeVisible();
}

test("a movement imported before the opening is said, and «Move the opening» counts it", async ({ page }) => {
  await test.step("the import of a movement two days before the opening says it", async () => {
    await openAccount(page);
    const button = page.getByRole("button", { name: "Import CSV" });
    await hydrated(button);
    await button.click();
    await page.getByLabel("File", { exact: true }).setInputFiles({
      name: "movements.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(`Data;Descrizione;Importo\n${csvDay(-7)};Edicola;-12,50\n`),
    });
    await page.getByRole("button", { name: "Read the file" }).click();
    await page.getByRole("heading", { name: "First rows" }).waitFor();
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await expect(page.getByText("1 transaction imported")).toBeVisible();
    await expect(page.getByTestId("csv-before-opening")).toHaveText(
      "1 transaction is before the opening balance: the balance does not count it. You can move the opening from the account's page.",
    );
    await page.getByRole("button", { name: "Close" }).click();
  });

  const banner = page.getByTestId("account-before-opening");

  await test.step("the balance does not move by itself, and the account's page says why", async () => {
    await expect(page.getByText("80,00 €").first()).toBeVisible();
    await expect(banner).toContainText("1 transaction is before the opening balance");
  });

  await test.step("«Move the opening» counts the movement, and the banner goes", async () => {
    const move = banner.getByRole("button", { name: /^Move the opening to / });
    await hydrated(move);
    await move.click();
    await expect(page.getByText(/^Opening moved to /)).toBeVisible();
    await expect(banner).toHaveCount(0);
    // 80,00 − 12,50: the opening now comes before the movement.
    await expect(page.getByText("67,50 €").first()).toBeVisible();
  });
});
