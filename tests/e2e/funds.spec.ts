// tests/e2e/funds.spec.ts — the journey of a fund fed by a recurring debit, at 1440 px (spec §7.7, §11;
// one fund model since release N6, docs/design/rewrite-plan/ux/n6-pension-fund.md §3, §9).
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

test("a fund with a debit is created, fed by its debits, valued and measured", async ({ page }) => {
  const { start, today } = dates();
  let fundUrl = "";

  await test.step("the fund is created from the form, with its debit and its two fees", async () => {
    await page.goto("/funds");
    await expect(page.getByRole("heading", { name: "No pension funds" })).toBeVisible();
    await page.getByRole("link", { name: "Add fund" }).first().click();
    await expect(page).toHaveURL(/\/funds\/new$/);
    const form = page.getByTestId("fund-wizard");
    await form.getByLabel("Name").fill("Fideuram Piano Accumulo");
    await form.getByLabel("Provider").fill("Fideuram");
    await form.getByLabel("Member since").fill(start);
    await form.getByRole("button", { name: "Continue" }).click();

    await expect(page).toHaveURL(/step=sources$/);
    await form.getByTestId("source-switch-bank_debit").click();
    await form.getByLabel("Expected amount").fill("251");
    await form.getByLabel("Paying account").selectOption({ label: "ING Conto Arancio" });
    await form.getByLabel("Debit day").fill("5");
    // The payee starts from the provider written in step 1.
    await expect(form.getByLabel("Payee contains")).toHaveValue("Fideuram");
    await form.getByRole("button", { name: "Continue" }).click();

    await expect(page).toHaveURL(/step=fees$/);
    for (const [name, type, value] of [
      ["Per deposit", "On each contribution", "1"],
      ["Management", "On assets", "1,2"],
    ] as const) {
      await form.getByRole("button", { name: "Add fee" }).click();
      const dialog = page.getByRole("dialog", { name: "Add fee" });
      await dialog.getByLabel("Name").fill(name);
      await dialog.getByLabel("Type").selectOption({ label: type });
      await dialog.getByLabel("Value").fill(value);
      await dialog.getByRole("button", { name: "Save fee" }).click();
      await expect(dialog).toBeHidden();
    }
    await form.getByRole("button", { name: "Continue" }).click();

    await expect(page).toHaveURL(/step=review$/);
    await form.getByRole("button", { name: "Create fund" }).click();
    await expect(page).toHaveURL(/\/funds\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "Fideuram Piano Accumulo", level: 1 })).toBeVisible();
    fundUrl = page.url();
  });

  await test.step("the initial capital is a contribution written by hand", async () => {
    await page.goto(`${fundUrl}?tab=contributions&preset=all`);
    await page.getByRole("button", { name: "Record contribution" }).first().click();
    const dialog = page.getByRole("dialog", { name: /Record contribution/ });
    await dialog.getByLabel("Date").fill(start);
    await dialog.getByLabel("Amount").fill("5000");
    // The form proposes the fee of each contribution: the initial capital pays none.
    await dialog.getByLabel("Fee", { exact: true }).fill("0");
    await dialog.getByRole("button", { name: "Save contribution" }).click();
    await expect(dialog).toBeHidden();
  });

  await test.step("the debit source turns the debits into contributions, less the fee", async () => {
    // The whole life of the fund: the three months may cross a new year.
    await page.goto(`${fundUrl}?tab=contributions&preset=all`);
    await expect(page.getByTestId("contribution-row")).toHaveCount(3);
    const matched = page.getByTestId("contribution-row").filter({ hasText: "Debit" });
    await expect(matched).toHaveCount(2);
    await expect(matched.first()).toContainText("250,00 €");
    await expect(page.getByTestId("fund-deposit-rule")).toContainText("Active");
  });

  await test.step("a value gives the gain on what was paid in", async () => {
    await page.getByRole("button", { name: "Update value" }).first().click();
    const dialog = page.getByRole("dialog", { name: /Update value/ });
    await dialog.getByLabel("Date of the value").fill(today);
    await dialog.getByLabel("Value (€)").fill("5600");
    await dialog.getByRole("button", { name: "Save value" }).click();
    await expect(dialog).toBeHidden();
    // 5.600 − (5.000 + 2 × 251) = +98,00 €.
    await page.goto(`${fundUrl}?preset=all`);
    await expect(page.getByTestId("funds-hero")).toContainText("+98,00 €");
    await page.getByRole("navigation", { name: "Fund" }).getByRole("link", { name: "Values" }).click();
    await expect(page.getByTestId("valuation-line")).toHaveCount(1);
  });

  await test.step("the list shows the fund and the palette finds it", async () => {
    await page.goto("/funds?preset=all");
    const row = page.getByTestId("fund-home-row");
    await expect(row).toContainText("Fideuram Piano Accumulo");
    await expect(row).toContainText("5.600,00 €");
    await expect(row).toContainText("5.502,00 €");
    await page.getByRole("button", { name: /Search or jump to/ }).click();
    await page.getByRole("combobox", { name: /Search or jump to/ }).fill("fideur");
    await expect(page.getByRole("option", { name: /Fideuram Piano Accumulo/ })).toBeVisible();
  });
});
