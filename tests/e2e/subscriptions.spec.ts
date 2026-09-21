// tests/e2e/subscriptions.spec.ts — the F3 Subscriptions journey at 1440 px (spec §7.5, §11).
import { expect, type Page, test } from "@playwright/test";
import { sessionState } from "./env";

// Its own user: three subscriptions, their movements, and a recurring gym (scripts/seed-e2e.ts).
test.use({ storageState: sessionState("subscriptions") });

const row = (page: Page, name: string) => page.getByTestId("subscription-row").filter({ hasText: name });

test("subscriptions are checked against the movements, projected and suggested", async ({ page }) => {
  await test.step("the check says what was paid, what differs and what is due", async () => {
    await page.goto("/subscriptions");
    await expect(page.getByRole("heading", { name: "Subscriptions", level: 1 })).toBeVisible();
    await expect(page.getByTestId("subscription-row")).toHaveCount(3);
    // At 1440 px with the sidebar open the name keeps a real column (spec §8.4 point 3).
    const name = row(page, "Netflix").getByRole("cell").first();
    expect((await name.boundingBox())!.width).toBeGreaterThan(200);
    await expect(row(page, "Netflix")).toContainText("Paid");
    await expect(row(page, "Spotify")).toContainText("Amount differs");
    await expect(row(page, "Amazon Prime")).toContainText("Due");
    await expect(page.getByTestId("subscription-alert")).toHaveCount(2);
    await expect(page.getByTestId("subscription-alert").filter({ hasText: "Spotify" })).toContainText(
      "charged 12,99 €",
    );
    // 12,99 + 10,99 + 49,90 / 12 a month; 12 × 12,99 + 12 × 10,99 + 49,90 a year.
    await expect(page.getByText("28,14 €").first()).toBeVisible();
    await expect(page.getByText("337,66 €").first()).toBeVisible();
  });

  await test.step("the due column says the unit of each cycle, and the category carries its colour", async () => {
    // A monthly subscription is identified by its day, a yearly one by its month (owner, F8.1).
    await expect(row(page, "Netflix")).toContainText(/Day \d{1,2}/);
    await expect(row(page, "Amazon Prime")).toContainText(
      /January|February|March|April|May|June|July|August|September|October|November|December/,
    );
    // The category tag is drawn in the category's own colour, which is never absent.
    const dot = row(page, "Netflix").locator("span[style*='background-color']").first();
    await expect(dot).toBeVisible();
    expect(await dot.evaluate((node) => getComputedStyle(node).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  });

  await test.step("the table sorts on a header", async () => {
    await page.getByRole("button", { name: "Name" }).click();
    await expect(page.getByTestId("subscription-row").first()).toContainText("Spotify");
    await page.getByRole("button", { name: "Name" }).click();
    await expect(page.getByTestId("subscription-row").first()).toContainText("Amazon Prime");
  });

  await test.step("updating the price turns the differing amount into a payment", async () => {
    await row(page, "Spotify").getByRole("button", { name: "Edit" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit subscription" });
    await expect(dialog).toContainText("Last match:");
    await dialog.getByLabel("Price (€)").fill("12,99");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(row(page, "Spotify")).toContainText("Paid");
    await expect(page.getByTestId("subscription-alert")).toHaveCount(1);
  });

  await test.step("the utility is set from the table", async () => {
    await row(page, "Amazon Prime")
      .getByRole("button", { name: /Set utility/ })
      .click();
    const dialog = page.getByRole("dialog", { name: "Edit subscription" });
    await dialog.getByRole("radio", { name: "7" }).click();
    await expect(dialog).toContainText("7 · essential");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(row(page, "Amazon Prime")).toContainText("7/10");
  });

  await test.step("a recurring payment is suggested and becomes a subscription", async () => {
    await page.getByRole("button", { name: /Suggest from recurring payments/ }).click();
    const list = page.getByRole("dialog", { name: "Suggested from recurring payments" });
    await expect(list).toContainText("FitActive");
    await list.getByRole("button", { name: "Add: FitActive" }).click();
    const dialog = page.getByRole("dialog", { name: "New subscription" });
    await expect(dialog.getByLabel("Name")).toHaveValue("FitActive");
    await expect(dialog.getByLabel("Price (€)")).toHaveValue("29,90");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("subscription-row")).toHaveCount(4);
  });

  await test.step("a cancelled subscription leaves the table", async () => {
    await row(page, "FitActive").getByRole("button", { name: "Edit" }).click();
    await page
      .getByRole("dialog", { name: "Edit subscription" })
      .getByRole("button", { name: "Cancel subscription" })
      .click();
    await expect(page.getByTestId("subscription-row")).toHaveCount(3);
    // Paused and cancelled are two folded sections now, not one list (F8.1).
    await expect(page.getByText("1 cancelled")).toBeVisible();
  });

  await test.step("a cancelled subscription can be thrown away for good", async () => {
    await page.getByText("1 cancelled").click();
    const cancelled = page.getByTestId("inactive-row").filter({ hasText: "FitActive" });
    await expect(cancelled).toBeVisible();
    await cancelled.getByRole("button", { name: "Delete" }).click();
    const confirm = page.getByRole("dialog", { name: "Delete this subscription?" });
    await expect(confirm).toContainText("cannot be undone");
    await confirm.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("1 cancelled")).toHaveCount(0);
    // The movements it was laid over are still there: only the plan went.
    await expect(page.getByTestId("subscription-row")).toHaveCount(3);
  });

  await test.step("the projection reads a month or a year of charges", async () => {
    const projection = page.getByTestId("projection");
    await expect(projection).toContainText("Revolut Main");
    await expect(projection).toContainText("1.500,00 €");
    await projection.getByRole("link", { name: "Year" }).click();
    await expect(page).toHaveURL(/proj=year/);
    await expect(projection).toContainText("next 12 months");
  });

  await test.step("the table exports as CSV", async () => {
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Export CSV" }).click();
    const file = await (await download).path();
    const { readFileSync } = await import("node:fs");
    const text = readFileSync(file, "utf8");
    expect(text).toContain("Netflix");
    expect(text).toContain("12,99");
  });
});
