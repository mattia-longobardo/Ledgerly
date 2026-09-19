// tests/e2e/interests.spec.ts — the F4 Interests journey at 1440 px (spec §7.6, §11).
import { expect, test } from "@playwright/test";
import { sessionState } from "./env";

// Its own user: 10.000,00 € on a savings account since before last month (scripts/seed-e2e.ts).
test.use({ storageState: sessionState("interests") });

/** Today and last month in Rome, as the site computes them. */
function lastMonth(): { first: string; days: number } {
  const [year, month] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" })
    .format(new Date())
    .split("-")
    .map(Number);
  const y = month === 1 ? year - 1 : year;
  const m = month === 1 ? 12 : month - 1;
  return { first: `${y}-${String(m).padStart(2, "0")}-01`, days: new Date(Date.UTC(y, m, 0)).getUTCDate() };
}

test("a rule accrues day by day and settles last month", async ({ page }) => {
  const { first, days } = lastMonth();

  await test.step("the page starts empty", async () => {
    await page.goto("/interests");
    await expect(page.getByRole("heading", { name: "No interest rules" })).toBeVisible();
  });

  await test.step("a rule is created from the dialog and opens on its page", async () => {
    await page.getByRole("button", { name: "Add rule" }).first().click();
    const dialog = page.getByRole("dialog", { name: "New interest rule" });
    await dialog.getByLabel("Starts on").fill(first);
    await dialog.getByLabel("Gross rate 1").fill("3,65");
    await dialog.getByLabel("Tax on interest").fill("0");
    await dialog.getByRole("button", { name: "Save rule" }).click();
    await expect(page).toHaveURL(/\/interests\/[0-9a-f-]{36}$/);
  });

  await test.step("last month is settled at 1,00 € a day, and no payment check without a text", async () => {
    const settlement = page.getByTestId("settlement-row").first();
    await expect(settlement).toContainText(`${days},00 €`);
    await expect(settlement).toContainText(`${days} accrued`);
    await expect(settlement).toContainText("No data");
    await expect(page.getByTestId("accrual-row").first()).toContainText("10.000,00 €");
  });

  await test.step("the list shows the rule with its tier", async () => {
    await page.getByRole("link", { name: "Interests" }).first().click();
    const row = page.getByTestId("rule-row");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Revolut Saving");
    await expect(row).toContainText(/3,65\s%/);
    await expect(row).toContainText("any balance");
    await expect(row).toContainText("Active");
  });
});
