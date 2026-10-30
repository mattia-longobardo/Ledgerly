// tests/e2e/schedule.spec.ts — the sync schedule editor of Settings › Integrations
// (docs/scheduler.md), on the seeded `layout` user's Paperless link, which starts on manual only and
// is put back there at the end. The address of that link does not exist, so a pass the dispatcher
// makes in between only records a failed run on a test user. Its control is the first on the page:
// the seeded eToro link (manual only too) has its own further down, and is never touched here.
import { expect, test } from "@playwright/test";
import { sessionState } from "./env";

test.use({ storageState: sessionState("layout") });

test("a sync at 06:43 on weekdays plus a cron rule: preview, save, card", async ({ page }) => {
  await page.goto("/settings/integrations");
  await page.getByRole("button", { name: "Change the sync schedule" }).first().click();
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
    await expect(page.getByText("At 06:43 · Mon–Fri +1")).toBeVisible();
    await expect(page.getByText(/^Next: .*(6:43|18:30)/)).toBeVisible();
  });

  await test.step("back to manual only", async () => {
    await page.getByRole("button", { name: "Change the sync schedule" }).first().click();
    await dialog.getByRole("radio", { name: /Manual only/ }).check();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("No automatic sync").first()).toBeVisible();
  });
});

test("a service's Connection tab shows its real schedule, with the same control", async ({ page }) => {
  await page.goto("/settings/integrations");
  const row = page.getByTestId("investment-connection").filter({ hasText: "eToro" });
  // Seeded on manual only: the tab used to say 07:30 and 22:30 whatever the schedule was.
  await expect(row.getByText("Manual only")).toBeVisible();
  await row.getByRole("link", { name: "Configure" }).click();
  const card = page.getByTestId("service-connection");
  await expect(card.getByText("Manual only")).toBeVisible();
  await expect(card.getByText("07:30")).toHaveCount(0);
  await card.getByRole("button", { name: "Change the sync schedule" }).click();
  await expect(page.getByRole("dialog", { name: "Sync schedule · eToro" })).toBeVisible();
});
