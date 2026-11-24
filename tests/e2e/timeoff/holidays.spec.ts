// tests/e2e/timeoff/holidays.spec.ts — the holiday calendars of Settings › Profile (M3), at 1440 px.
//
// This one really does reach openholidaysapi.org: "aggiornati online" is the requirement, and a
// test that stubbed the service would prove only that the stub works. If it fails while everything
// else passes, look at the service before looking at the code.
import { expect, test } from "@playwright/test";
import { sessionState } from "../_shared/env";
import { THIS_YEAR } from "../_shared/helpers";

// The tests of this file change the data of their own user and each puts back what it changed, so a
// second run finds what the seed made (no data left by the run before).
test.describe.configure({ mode: "default" });

test.use({ storageState: sessionState("timeoffHolidays") });

const YEAR = THIS_YEAR;

test("a calendar is picked by country and place, and its days arrive from the source", async ({ page }) => {
  await test.step("with no calendar, the screen says what is used instead", async () => {
    await page.goto("/timeoff/settings");
    await expect(page.getByRole("heading", { name: "Public holidays" })).toBeVisible();
    await expect(page.getByText("No calendar yet")).toBeVisible();
    // Without one only the working week is known (R5g): said beside the calendars.
    await expect(page.getByTestId("no-holiday-calendar")).toBeVisible();
  });

  await test.step("the country list comes from the two services", async () => {
    await page.getByRole("button", { name: "Add a calendar" }).click();
    const dialog = page.getByRole("dialog", { name: "Add a holiday calendar" });
    const country = dialog.getByLabel("Country");
    // The list is fetched when the dialog opens; until it lands the select says so.
    await expect(country.locator("option", { hasText: "Italy" })).toHaveCount(1, { timeout: 20_000 });
    // Somewhere Nager covers and OpenHolidays does not: the rest of the world is there too.
    await expect(country.locator("option", { hasText: "Japan" })).toHaveCount(1);
  });

  await test.step("Italy offers its provinces, because that is where a patron saint lives", async () => {
    const dialog = page.getByRole("dialog", { name: "Add a holiday calendar" });
    await dialog.getByLabel("Country").selectOption({ label: "Italy" });
    const place = dialog.getByLabel("Region or province");
    await expect(place).toBeVisible();
    // The names come back in the session's own language, so an English session says "Milan".
    await expect(place.locator("option", { hasText: "Milan" })).toHaveCount(1, { timeout: 20_000 });
    await place.selectOption({ label: "Lombardy · Milan" });
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
  });

  await test.step("the days are fetched at once, and the local feast is among them", async () => {
    const row = page.getByRole("listitem").filter({ hasText: "Lombardy · Milan" });
    await expect(row).toBeVisible();
    // Italy has a dozen public holidays; Milan has one more than the rest of the country.
    await expect(row).toContainText(new RegExp(`1[0-9] days in ${YEAR}`));
    await expect(row).toContainText("OpenHolidays");
    await expect(row).not.toContainText("Last update failed");
  });

  await test.step("the leave calendar now refuses the day the province does not work", async () => {
    await page.goto(`/timeoff?year=${YEAR}`);
    // 7 December is Sant'Ambrogio in Milan: not a button, because it cannot be booked.
    await expect(page.locator(`button[data-date="${YEAR}-12-07"]`)).toHaveCount(0);
    await expect(page.locator(`[data-date="${YEAR}-12-07"]`)).toHaveCount(1);
  });

  await test.step("removing it puts the days back the way they were", async () => {
    await page.goto("/timeoff/settings");
    page.once("dialog", (confirm) => confirm.accept());
    await page
      .getByRole("listitem")
      .filter({ hasText: "Lombardy · Milan" })
      .getByRole("button", { name: "Remove" })
      .click();
    await expect(page.getByText("No calendar yet")).toBeVisible();
  });
});

test("a day off of the year and the working day are saved on their own, on Time off › Settings", async ({
  page,
}) => {
  await page.goto("/timeoff/settings");
  const hoursBefore = await page.getByLabel("Hours in a working day").inputValue();

  await test.step("a day off of the year is added with its own button, and the calendar keeps it", async () => {
    const add = page.getByTestId("add-rest-day");
    await add.getByLabel("Month").selectOption({ label: "December" });
    await add.getByLabel("Day").selectOption("7");
    await add.getByLabel("Name").fill("Sant'Ambrogio");
    await add.getByRole("button", { name: "Add the day off" }).click();
    await expect(page.getByText("7 December · Sant'Ambrogio added")).toBeVisible();
    await expect(page.getByTestId("rest-days")).toContainText("7 December · Sant'Ambrogio");

    await page.goto(`/timeoff?year=${YEAR}`);
    // A day the person does not work: not a button, because it cannot be booked.
    await expect(page.locator(`button[data-date="${YEAR}-12-07"]`)).toHaveCount(0);
    await expect(page.locator(`[data-date="${YEAR}-12-07"]`)).toHaveCount(1);
  });

  await test.step("the working day is saved apart from it", async () => {
    await page.goto("/timeoff/settings");
    await page.getByLabel("Hours in a working day").fill("7.5");
    await page.getByTestId("unsaved-banner").getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Working hours saved")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Hours in a working day")).toHaveValue("7.5");
  });

  await test.step("neither is on the Profile form any more", async () => {
    await page.goto("/settings/profile");
    await expect(page.getByLabel("Patron saint holiday")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Time off › Settings" })).toBeVisible();
  });

  await test.step("as the test found the user: no day off, and the working day of the seed", async () => {
    await page.goto("/timeoff/settings");
    // Removing asks first, and says afterwards which day went.
    page.once("dialog", (confirm) => confirm.accept());
    await page.getByRole("button", { name: "Remove Sant'Ambrogio" }).click();
    await expect(page.getByText("7 December · Sant'Ambrogio removed")).toBeVisible();
    await expect(page.getByTestId("rest-days")).toHaveCount(0);
    await page.getByLabel("Hours in a working day").fill(hoursBefore);
    await page.getByTestId("unsaved-banner").getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Working hours saved").last()).toBeVisible();
  });
});
