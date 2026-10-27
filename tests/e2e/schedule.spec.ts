// tests/e2e/schedule.spec.ts — the sync schedule editor of Settings › Integrations
// (docs/scheduler.md), on the seeded `layout` user's Paperless link, which starts on manual only and
// is put back there at the end. The address of that link does not exist, so a pass the dispatcher
// makes in between only records a failed run on a test user.
import { expect, test } from "@playwright/test";
import { sessionState } from "./env";

test.use({ storageState: sessionState("layout") });

test("a sync at 06:43 on weekdays plus a cron rule: preview, save, card", async ({ page }) => {
  await page.goto("/settings/integrations");
  await page.getByRole("button", { name: "Change the sync schedule" }).click();
  const dialog = page.getByRole("dialog", { name: "Sync schedule" });
  await expect(dialog).toBeVisible();

  await test.step("a preset fills the editor, and the time is set to the minute", async () => {
    await dialog.getByRole("button", { name: "Weekdays at 8:00" }).click();
    await dialog.getByRole("button", { name: "Remove 08:00 from rule 1" }).click();
    await dialog.getByLabel("New time for rule 1").fill("06:43");
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await expect(dialog.getByRole("listitem").filter({ hasText: "06:43" }).first()).toBeVisible();
  });

  await test.step("a second rule, in cron, joins the preview in time order", async () => {
    await dialog.getByRole("button", { name: "Add a rule" }).click();
    await dialog.getByLabel("Kind of rule 2").selectOption("cron");
    const cron = dialog.getByLabel("Cron expression");
    await cron.fill("30 18 * * 6,0");
    const preview = dialog.getByRole("list", { name: "Next 5 syncs" });
    await expect(preview.getByRole("listitem")).toHaveCount(5);
    const items = await preview.getByRole("listitem").allTextContents();
    // The preview speaks the person's locale: en-US writes 18:30 as 06:30 PM.
    expect(items.some((item) => item.includes("06:43 AM"))).toBe(true);
    expect(items.every((item) => /06:43 AM|06:30 PM/.test(item))).toBe(true);
  });

  await test.step("too close is refused before saving", async () => {
    await dialog.getByLabel("Cron expression").fill("50 6 * * *");
    await expect(dialog.getByText(/Two syncs at 06:43 and 06:50/)).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
    await dialog.getByLabel("Cron expression").fill("30 18 * * 6,0");
  });

  await test.step("saved: the card sums it up and names the next pass", async () => {
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("At 06:43 · Mon–Fri +1")).toBeVisible();
    await expect(page.getByText(/^Next: .*(6:43|6:30)/)).toBeVisible();
  });

  await test.step("back to manual only", async () => {
    await page.getByRole("button", { name: "Change the sync schedule" }).click();
    await dialog.getByRole("button", { name: "Manual only" }).click();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("No automatic sync")).toBeVisible();
  });
});
