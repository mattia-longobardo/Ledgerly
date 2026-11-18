// tests/e2e/connections/schedule.spec.ts — the sync schedule editor (docs/scheduler.md), on the page of
// the source from release N7.2 (plugin-settings.md §2.2), on the seeded
// `schedule` user's Trek link, which starts on manual only and is put back there at the end. The
// address of that link does not exist, so a pass the dispatcher makes in between only records a
// failed run on a test user. The rows are in order of name, so Trek's control is found by its
// row: the seeded eToro and Binance links (manual only too) have their own, never touched here.
import { expect, test } from "@playwright/test";
import { sessionState } from "../_shared/env";

// The tests of this file change the data of one user, each from what the one before left: they run
// in order, on one worker, while the other files run beside them (playwright.preview.config.ts).
test.describe.configure({ mode: "default" });

test.use({ storageState: sessionState("schedule") });

test("a sync at 06:43 on weekdays plus a cron rule: preview, save, card", async ({ page }) => {
  await page.goto("/settings/integrations/trek");
  const trek = page.getByTestId("schedule-row").filter({ hasText: "Trek" });
  await trek.getByRole("button", { name: "Change the sync schedule" }).click();
  const dialog = page.getByRole("dialog", { name: "Sync schedule" });
  await expect(dialog).toBeVisible();

  await test.step("at set times, the time is set to the minute", async () => {
    await dialog.getByRole("radio", { name: /At set times/ }).check();
    await dialog.getByRole("button", { name: "Remove 07:30" }).click();
    await dialog.getByRole("button", { name: "Remove 22:30" }).click();
    await dialog.getByLabel("New time").fill("06:43");
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await dialog.getByRole("button", { name: "Mon–Fri" }).click();
    await expect(dialog.getByRole("listitem").filter({ hasText: "06:43" }).first()).toBeVisible();
  });

  await test.step("custom rules start from it; a cron rule joins the preview in time order", async () => {
    await dialog.getByRole("radio", { name: /Custom rules/ }).check();
    await dialog.getByRole("button", { name: "Add a rule" }).click();
    await dialog.getByLabel("Kind of rule 2").selectOption("cron");
    const cron = dialog.getByLabel("Cron expression", { exact: true });
    await cron.fill("30 18 * * 6,0");
    const preview = dialog.getByRole("list", { name: "Next syncs" });
    await expect(preview.getByRole("listitem")).toHaveCount(5);
    const items = await preview.getByRole("listitem").allTextContents();
    // 24 hours, whatever the language: the summary and the fields write it the same way.
    expect(items.some((item) => item.includes("06:43"))).toBe(true);
    expect(items.every((item) => /06:43|18:30/.test(item))).toBe(true);
  });

  await test.step("too close is refused before saving", async () => {
    await dialog.getByLabel("Cron expression", { exact: true }).fill("50 6 * * *");
    await expect(dialog.getByText(/Two syncs at 06:43 and 06:50/)).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
    await dialog.getByLabel("Cron expression", { exact: true }).fill("30 18 * * 6,0");
  });

  await test.step("saved: the card sums it up and names the next pass", async () => {
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(trek.getByText("At 06:43 · Mon–Fri +1")).toBeVisible();
    await expect(trek.getByText(/^Next: .*(6:43|18:30)/)).toBeVisible();
  });

  await test.step("back to manual only", async () => {
    await trek.getByRole("button", { name: "Change the sync schedule" }).click();
    await dialog.getByRole("radio", { name: /Manual only/ }).check();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(trek.getByText("No automatic sync")).toBeVisible();
  });
});

test("a service's Connection tab shows its real schedule, with the same control", async ({ page }) => {
  await page.goto("/settings/integrations");
  const row = page.getByTestId("investment-connection").filter({ hasText: "eToro" });
  // Seeded on manual only: the row says the automatic update is off, and the tab used to say
  // 07:30 and 22:30 whatever the schedule was.
  await expect(row.getByText("Paused")).toBeVisible();
  await expect(row.getByText("Automatic update is off.")).toBeVisible();
  await row.getByRole("button", { name: "eToro" }).click();
  await page.getByRole("menuitem", { name: "Connection settings" }).click();
  const card = page.getByTestId("service-connection");
  await expect(card.getByText("Manual only")).toBeVisible();
  await expect(card.getByText("07:30")).toHaveCount(0);
  await card.getByRole("button", { name: "Change the sync schedule" }).click();
  await expect(page.getByRole("dialog", { name: "Sync schedule · eToro" })).toBeVisible();
});
