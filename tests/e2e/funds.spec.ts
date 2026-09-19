// tests/e2e/funds.spec.ts — the F4 PAC journey at 1440 px (spec §7.7, §11).
import { expect, test } from "@playwright/test";
import { sessionState } from "./env";

// Its own user: two Fideuram debits on a synced account (scripts/seed-e2e.ts).
test.use({ storageState: sessionState("funds") });

/** The first day of the month three months back, and today, in Rome. */
function dates(): { start: string; today: string } {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(new Date());
  const [year, month] = today.split("-").map(Number);
  const back = new Date(Date.UTC(year, month - 1 - 3, 1));
  return { start: back.toISOString().slice(0, 10), today };
}

test("a PAC is created, fed by its debits, valued and measured", async ({ page }) => {
  const { start, today } = dates();

  await test.step("the fund is created from the dialog, with its initial capital", async () => {
    await page.goto("/funds");
    await expect(page.getByRole("heading", { name: "No investment funds" })).toBeVisible();
    await page.getByRole("button", { name: "Add fund" }).first().click();
    const dialog = page.getByRole("dialog", { name: "New fund" });
    await dialog.getByLabel("Name").fill("Fideuram Piano Accumulo");
    await dialog.getByLabel("Provider").fill("Fideuram");
    await dialog.getByLabel("Start date").fill(start);
    await dialog.getByLabel("Monthly amount debited (€)").fill("251");
    await dialog.getByLabel("Fee per deposit (€)").fill("1");
    await dialog.getByLabel("Paying account").selectOption({ label: "ING Conto Arancio" });
    await dialog.getByLabel("Charge day").fill("5");
    await dialog.getByLabel("Annual management fee (TER, %)").fill("1,2");
    await dialog.getByLabel("Initial capital (€)").fill("5000");
    await dialog.getByRole("button", { name: "Save fund" }).click();
    await expect(page).toHaveURL(/\/funds\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "Fideuram Piano Accumulo", level: 1 })).toBeVisible();
  });

  await test.step("the linked expense rule turns the debits into deposits, less the fee", async () => {
    await page.getByRole("navigation", { name: "Fund" }).getByRole("link", { name: "Settings" }).click();
    await expect(page.getByLabel("Payee contains")).toHaveValue("Fideuram");
    await page.getByRole("button", { name: "Save rule" }).click();
    await page.getByRole("navigation", { name: "Fund" }).getByRole("link", { name: "Deposits" }).click();
    await expect(page.getByTestId("deposit-row")).toHaveCount(3);
    const matched = page.getByTestId("deposit-row").filter({ hasText: "Matched" });
    await expect(matched).toHaveCount(2);
    await expect(matched.first()).toContainText("250,00 €");
    await expect(page.getByTestId("deposit-rule")).toContainText("Active");
  });

  await test.step("a valuation gives the value, the gain on what was paid in", async () => {
    await page.getByRole("button", { name: "Record valuation" }).click();
    const dialog = page.getByRole("dialog", { name: /Record valuation/ });
    await dialog.getByLabel("Valuation date").fill(today);
    await dialog.getByLabel("Current value (€)").fill("5600");
    await dialog.getByRole("button", { name: "Save valuation" }).click();
    await expect(dialog).toBeHidden();
    // 5.600 − (5.000 + 2 × 251) = +98,00 €.
    await expect(page.getByText("+98,00 €").first()).toBeVisible();
    await page.getByRole("navigation", { name: "Fund" }).getByRole("link", { name: "Valuations" }).click();
    await expect(page.getByTestId("valuation-row")).toHaveCount(1);
  });

  await test.step("the list shows the fund and the palette finds it", async () => {
    await page.goto("/funds");
    const row = page.getByTestId("fund-row");
    await expect(row).toContainText("Fideuram Piano Accumulo");
    await expect(row).toContainText("5.600,00 €");
    await expect(row).toContainText("5.502,00 €");
    await page.getByRole("button", { name: /Search or jump to/ }).click();
    await page.getByRole("combobox", { name: /Search or jump to/ }).fill("fideur");
    await expect(page.getByRole("option", { name: /Fideuram Piano Accumulo/ })).toBeVisible();
  });
});
