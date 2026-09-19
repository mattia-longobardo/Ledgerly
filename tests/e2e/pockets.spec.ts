// tests/e2e/pockets.spec.ts — the F3 Pockets journey at 1440 px (spec §7.4, §11).
import { expect, test } from "@playwright/test";
import { sessionState } from "./env";

// Its own user: a savings account and two pockets, one on it and one standalone (scripts/seed-e2e.ts).
test.use({ storageState: sessionState("pockets") });

test("pockets earmark money without moving it, and the free balance follows", async ({ page }) => {
  const detail = page.getByTestId("pocket-detail");

  await test.step("the page opens on the figures of the seeded pockets", async () => {
    await page.goto("/pockets");
    await expect(page.getByRole("heading", { name: "Pockets", level: 1 })).toBeVisible();
    await expect(page.getByTestId("pocket-card")).toHaveCount(2);
    // 3.250 + 50 earmarked; 10.000 − 3.250 free on the one account a pocket rests on.
    await expect(page.getByText("3.300,00 €").first()).toBeVisible();
    await expect(page.getByText("6.750,00 €").first()).toBeVisible();
    // The list is by name, so the page opens on Gifts; the card selects Holidays.
    await page.getByTestId("pocket-card").filter({ hasText: "Holidays" }).click();
    await expect(page).toHaveURL(/pocket=/);
    await expect(detail).toContainText("Holidays · on Revolut Saving");
    await expect(detail).toContainText("3.250,00 €");
    await expect(detail).toContainText(/ETA 3 months/);
    // No interest rule on the account: unknown, never zero (spec §7.4).
    await expect(detail).toContainText("No interest rule on the account, or no positive balance.");
    await expect(page.getByRole("row").filter({ hasText: "Ischia — hotel + traghetto" })).toContainText(
      "−850,00 €",
    );
  });

  await test.step("adding to the pocket shows what is free and what it becomes", async () => {
    await detail.getByRole("button", { name: "Add to pocket" }).click();
    const dialog = page.getByRole("dialog", { name: "Add to Holidays" });
    await dialog.getByLabel("Amount").fill("250");
    await expect(dialog).toContainText("Free on Revolut Saving: 6.500,00 €");
    await expect(dialog).toContainText("Pocket after: 3.500,00 €");
    await dialog.getByRole("button", { name: "Add to pocket" }).click();
    await expect(dialog).toBeHidden();
    await expect(detail).toContainText("3.500,00 €");
    await expect(detail).toContainText(/ETA 2 months/);
  });

  await test.step("a withdrawal larger than the pocket is refused, a smaller one recorded", async () => {
    await detail.getByRole("button", { name: "Record withdrawal" }).click();
    const dialog = page.getByRole("dialog", { name: "Record withdrawal" });
    await dialog.getByLabel("Amount (€)").fill("5000");
    await dialog.getByLabel("Purpose").fill("Car");
    await dialog.getByRole("button", { name: "Record" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("The pocket doesn't hold that much.");
    await dialog.getByLabel("Amount (€)").fill("500");
    await dialog.getByRole("button", { name: "Record" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("row").filter({ hasText: "Car" })).toContainText("−500,00 €");
    await expect(detail).toContainText("3.000,00 €");
  });

  await test.step("the standalone pocket is open-ended and shows no free balance", async () => {
    await page.getByTestId("pocket-card").filter({ hasText: "Gifts" }).click();
    await expect(page).toHaveURL(/pocket=/);
    await expect(detail).toContainText("standalone envelope");
    await expect(detail).toContainText("Open-ended pocket");
  });

  await test.step("a new pocket is created, then edited", async () => {
    await page.getByRole("button", { name: "+ New pocket" }).click();
    const dialog = page.getByRole("dialog", { name: "New pocket" });
    await dialog.getByLabel("Name").fill("New laptop");
    await dialog.getByLabel("Target (€) · optional").fill("2200");
    await dialog.getByLabel("Monthly accrual (€)").fill("200");
    await dialog.getByRole("button", { name: "Save pocket" }).click();
    await expect(dialog).toBeHidden();
    await expect(detail).toContainText("New laptop");
    // Starting this month, it accrues this month at once.
    await expect(detail).toContainText("200,00 €");

    await detail.getByRole("button", { name: "Edit pocket" }).click();
    const edit = page.getByRole("dialog", { name: "Edit pocket" });
    await edit.getByLabel("Name").fill("Laptop");
    await edit.getByRole("button", { name: "Save pocket" }).click();
    await expect(edit).toBeHidden();
    await expect(page.getByTestId("pocket-card").filter({ hasText: "Laptop" })).toHaveCount(1);
  });

  await test.step("the ⌘K palette finds a pocket by name (spec §8.2)", async () => {
    await page.getByRole("button", { name: /Search or jump to/ }).click();
    await page.getByRole("combobox", { name: /Search or jump to/ }).fill("holi");
    await page.getByRole("option", { name: /Holidays/ }).click();
    await expect(detail).toContainText("Holidays · on Revolut Saving");
  });

  await test.step("Overview shows the pockets as its fourth figure", async () => {
    await page.goto("/");
    // 3.000 + 50 + 200 earmarked, 250 + 50 + 200 a month.
    await expect(page.getByText("3.250,00 €").first()).toBeVisible();
    await expect(page.getByText("+500 € · per month")).toBeVisible();
    await expect(page.getByText("3 pockets")).toBeVisible();
  });
});
