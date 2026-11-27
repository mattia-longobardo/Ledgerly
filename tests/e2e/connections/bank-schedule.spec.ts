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
// The outcome of «Choose accounts» names no count of readings: it stays true with any schedule.
const OUTCOME_SCHEDULE =
  'Settings shows when Ledgerly reads the bank: "Change" sets the times, "Update now" reads it right now.';

/** Puts the schedule of Beta Bank's connection through the API, as the dialog would. */
async function scheduleTimes(page: Page, times: string[]): Promise<string> {
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
  return id as string;
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
  await expect(page.getByText(OUTCOME_SCHEDULE)).toBeVisible();
  await expect(page.getByText(/times a day/)).toHaveCount(0);
  await expect((await scheduleRow(page)).getByText("At 06:30, 12:30, 18:30")).toBeVisible();
});

test("the outcome of «Choose accounts» is true with the recommended schedule too", async ({ page }) => {
  const id = await scheduleTimes(page, ["07:10", "13:10", "19:10"]);
  await page.goto(`/banks/connect?step=done&c=${id}`);
  await expect(page.getByRole("heading", { level: 1, name: `${BANK} is connected` })).toBeVisible();
  await expect(page.getByText(OUTCOME_SCHEDULE)).toBeVisible();
  await expect(page.getByText(/times a day/)).toHaveCount(0);
});

/**
 * «Try again now» on Gamma Bank, whose first reading failed (scripts/seed-e2e/plugins.ts). The answer of
 * the reading is the browser's: the route answers it, so nothing reads a bank here.
 */
test.describe("«Try again now» on a failed first reading", () => {
  const GAMMA = "Gamma Bank";

  async function retry(page: Page, answer: { status: number; reason?: string }) {
    const list = await page.request.get("/api/v1/connections");
    const { connections }: { connections: { id: string; name: string }[] } = await list.json();
    const id = connections.find((one) => one.name === GAMMA)?.id;
    expect(id, GAMMA).toBeTruthy();
    let reads = 0;
    await page.route(`**/api/v1/connections/${id}/read`, (route) => {
      reads += 1;
      return answer.status === 204
        ? route.fulfill({ status: 204 })
        : route.fulfill({ status: answer.status, json: { error: "conflict", reason: answer.reason } });
    });
    await page.goto(`/banks/connect?step=done&c=${id}`);
    await expect(page.getByRole("heading", { level: 1, name: `${GAMMA} is connected` })).toBeVisible();
    const button = page.getByRole("button", { name: "Try again now" });
    await hydrated(button);
    return { button, reads: () => reads };
  }

  test("a reading already running is said, and nothing reads as done", async ({ page }) => {
    const { button, reads } = await retry(page, { status: 409, reason: "busy" });
    await button.click();
    await expect(page.getByRole("alert").filter({ hasText: "A reading is already running." })).toBeVisible();
    expect(reads()).toBe(1);
    // The outcome stays the failed one: no way on to the accounts, «Try again now» still there.
    await expect(
      page.getByText("The accounts are connected, but the transactions were not read."),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to accounts" })).toHaveCount(0);
    await expect(button).toBeEnabled();
  });

  test("another refusal says its own reason", async ({ page }) => {
    const { button } = await retry(page, { status: 409, reason: "provider_down" });
    await button.click();
    await expect(page.getByRole("alert").filter({ hasText: `${GAMMA} is not responding.` })).toBeVisible();
    await expect(page.getByText("A reading is already running.")).toHaveCount(0);
  });

  test("a reading that ran reads the outcome again, with no refusal", async ({ page }) => {
    const { button, reads } = await retry(page, { status: 204 });
    const refreshed = page.waitForRequest((request) => request.headers()["rsc"] === "1");
    await button.click();
    await refreshed;
    expect(reads()).toBe(1);
    await expect(page.getByText("A reading is already running.")).toHaveCount(0);
    await expect(page.getByText(`${GAMMA} is not responding.`)).toHaveCount(0);
  });
});
