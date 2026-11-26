// tests/e2e/connections/bank-schedule.spec.ts — the schedule of a bank's connection: the same dialog
// as Trek and Wallet, with at most `MAX_BANK_SYNCS_PER_DAY` passes a day (docs/scheduler.md). The
// seeded `bankSchedule` user has one bank, "Beta Bank", on the recommended schedule. Each test puts
// the schedule it starts from through the API, so none depends on what another left. Nothing here
// reads the bank: its credentials are not credentials, and the next pass is days away.
import { expect, type Page, test } from "@playwright/test";
import { SESSION_CSRF_HEADER } from "@ledgerly/api-contract/core";
import { BASE_URL, sessionState } from "../_shared/env";
import { hydrated } from "../_shared/helpers";

// One user for the whole file: the tests run in order, on one worker (playwright.preview.config.ts).
test.describe.configure({ mode: "default" });

test.use({ storageState: sessionState("bankSchedule") });

const BANKS = "/settings/plugins/enablebanking";
const BANK = "Beta Bank";
const RECOMMENDED = "At 07:10, 13:10, 19:10";

/** Puts the schedule of Beta Bank's connection through the API, as the dialog would. */
async function scheduleTimes(page: Page, times: string[]): Promise<void> {
  const list = await page.request.get("/api/v1/connections");
  expect(list.status()).toBe(200);
  const { connections }: { connections: { id: string; name: string }[] } = await list.json();
  const id = connections.find((one) => one.name === BANK)?.id;
  expect(id, BANK).toBeTruthy();
  const rules = times.length === 0 ? [] : [{ kind: "times", times, days: { kind: "every" } }];
  const saved = await page.request.put(`/api/v1/connections/${id}/schedule`, {
    data: { rules },
    // A session write is the app's only when it comes from its origin with the CSRF proof.
    headers: { origin: new URL(BASE_URL).origin, [SESSION_CSRF_HEADER]: "1" },
  });
  expect(saved.status(), await saved.text()).toBe(204);
}

/** Beta Bank's line under «Schedule», hydrated. */
async function scheduleRow(page: Page) {
  await page.goto(BANKS);
  const row = page
    .getByRole("region", { name: "Schedule" })
    .getByTestId("schedule-row")
    .filter({ hasText: BANK });
  await hydrated(row.getByRole("button", { name: "Change the sync schedule" }));
  return row;
}

async function openDialog(page: Page) {
  const row = await scheduleRow(page);
  await row.getByRole("button", { name: "Change the sync schedule" }).click();
  const dialog = page.getByRole("dialog", { name: `Sync schedule · ${BANK}` });
  await expect(dialog).toBeVisible();
  return { row, dialog };
}

async function addTime(dialog: ReturnType<Page["getByRole"]>, time: string): Promise<void> {
  await dialog.getByLabel("New time").fill(time);
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
}

test("a schedule of its own is saved: the card sums it up and names the next pass", async ({ page }) => {
  await scheduleTimes(page, ["07:10", "13:10", "19:10"]);
  const { row, dialog } = await openDialog(page);
  for (const time of ["07:10", "13:10", "19:10"]) {
    await dialog.getByRole("button", { name: `Remove ${time}` }).click();
  }
  for (const time of ["06:30", "12:30", "18:30"]) await addTime(dialog, time);
  await expect(dialog.getByRole("list", { name: "Next syncs" }).getByRole("listitem").first()).toContainText(
    /06:30|12:30|18:30/,
  );
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(row.getByText("At 06:30, 12:30, 18:30")).toBeVisible();
  await expect(row.getByText(/^Next: .*(6:30|12:30|18:30)/)).toBeVisible();
});

test("over four passes a day: the dialog says so and Save stays off; four are saved", async ({ page }) => {
  await scheduleTimes(page, ["07:10", "13:10", "19:10"]);
  const { row, dialog } = await openDialog(page);
  const save = dialog.getByRole("button", { name: "Save" });

  await test.step("a fourth time is allowed", async () => {
    await addTime(dialog, "22:00");
    await expect(dialog.getByRole("list", { name: "Next syncs" })).toBeVisible();
    await expect(save).toBeEnabled();
  });

  await test.step("a fifth is too many", async () => {
    await addTime(dialog, "23:00");
    await expect(
      dialog.getByText("5 syncs in one day: this connection allows at most 4 a day."),
    ).toBeVisible();
    await expect(save).toBeDisabled();
  });

  await test.step("every hour is not offered under Repeat", async () => {
    await dialog.getByRole("radio", { name: /Repeat/ }).check();
    const every = dialog.getByLabel("Every");
    await expect(every.locator("option", { hasText: "1 h" })).toBeDisabled();
    await expect(every.locator("option", { hasText: "6 h" })).toBeEnabled();
  });

  await test.step("back to four times, saved", async () => {
    await dialog.getByRole("radio", { name: /At set times/ }).check();
    await dialog.getByRole("button", { name: "Remove 23:00" }).click();
    await expect(save).toBeEnabled();
    await save.click();
    await expect(dialog).toBeHidden();
    await expect(row.getByText("At 07:10, 13:10, 19:10 and 1 more")).toBeVisible();
  });
});

test("«Use recommended» puts back 07:10, 13:10 and 19:10", async ({ page }) => {
  await scheduleTimes(page, ["06:30", "12:30", "18:30"]);
  const { row, dialog } = await openDialog(page);
  await dialog.getByRole("button", { name: `Use recommended (${RECOMMENDED})` }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(row.getByText(RECOMMENDED, { exact: true })).toBeVisible();
});

test("on demand only, then «Turn on automatic update» puts back the recommended schedule", async ({
  page,
}) => {
  await scheduleTimes(page, ["06:30", "12:30", "18:30"]);
  const { row, dialog } = await openDialog(page);
  await dialog.getByRole("radio", { name: /On demand only/ }).check();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(row.getByText("No automatic sync")).toBeVisible();

  await page.getByRole("button", { name: "Turn on automatic update" }).click();
  await expect(page.getByText("Automatic update turned on again")).toBeVisible();
  await expect((await scheduleRow(page)).getByText(RECOMMENDED, { exact: true })).toBeVisible();
});

test("choosing the accounts again keeps the schedule chosen", async ({ page }) => {
  await scheduleTimes(page, ["06:30", "12:30", "18:30"]);
  await page.goto(BANKS);
  await page
    .getByRole("region", { name: "Accounts" })
    .getByRole("link", { name: `Choose accounts of ${BANK}` })
    .click();
  // «Import 1 account» the first time; «Continue» once the account is already linked to it.
  const submit = page.getByRole("button", { name: /^(Import|Continue)/ });
  await hydrated(submit);
  await submit.click();
  await expect(page.getByRole("heading", { level: 1, name: `${BANK} is connected` })).toBeVisible();
  await expect((await scheduleRow(page)).getByText("At 06:30, 12:30, 18:30")).toBeVisible();
});
