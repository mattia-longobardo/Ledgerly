// tests/e2e/timeoff.spec.ts — the Time off journey at 1440 px (spec §7.9, §11).
//
// Trek stays unlinked throughout: there is no test Trek to talk to, so the screen must stand on
// its own and no pass may be attempted (plan F7 §3.5).
import { type Page, expect, test } from "@playwright/test";
import { sessionState } from "./env";

// Its own user: 26 days of vacation and 4 days of ROL, one vacation day two weeks back, one three
// weeks ahead, and half a day of ROL (scripts/seed-e2e.ts). No payslips at all, which is what makes
// every one of those days "planned" (N2) — and, since N9, what leaves the carry-over at nothing:
// it is the payslip's own A.P. column or it is not there.
test.use({ storageState: sessionState("timeoff") });

const YEAR = new Date().getFullYear();

/**
 * The Monday of the first whole working week of March, as `YYYY-MM-DD`, and the days after it. No
 * Italian holiday falls there, so the five days are five working days whatever the year.
 */
function marchWeek(): string[] {
  const monday = new Date(Date.UTC(YEAR, 2, 8));
  while (monday.getUTCDay() !== 1) monday.setUTCDate(monday.getUTCDate() + 1);
  return Array.from({ length: 5 }, (_, index) => {
    const day = new Date(monday);
    day.setUTCDate(monday.getUTCDate() + index);
    return day.toISOString().slice(0, 10);
  });
}
const [MON, TUE, WED, THU, FRI] = marchWeek();

const cell = (page: Page, date: string) => page.locator(`[data-date="${date}"]`);
/** The rows of the table that are about one of the week's days: "10 Mar 2026". */
const rowsOf = (page: Page, date: string) =>
  page.getByRole("row").filter({ hasText: `${Number(date.slice(8))} Mar ${YEAR}` });

/**
 * Every write this page can make is a Server Action — a POST carrying `next-action` — so counting
 * those is counting the writes (rewrite plan N5, criterion 3).
 */
function countWrites(page: Page): () => number {
  let writes = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.headers()["next-action"] !== undefined) writes += 1;
  });
  return () => writes;
}

test("time off counts the year, says where each number comes from, and refuses a day nobody works", async ({
  page,
}) => {
  await test.step("the allowance reads in one unit — days, ROL included (N5)", async () => {
    await page.goto("/timeoff");
    await expect(page.getByRole("heading", { name: "Work & Time off", level: 1 })).toBeVisible();
    await expect(page.getByText("26 days vacation")).toBeVisible();
    // ROL is granted in days since N9, so the header says it in the same unit as vacation.
    await expect(page.getByText("4 d ROL")).toBeVisible();
    // Nothing is carried over: the figure comes from a payslip, and this user has none.
    await expect(page.getByText("carried over from your payslip")).toHaveCount(0);
  });

  await test.step("nothing is 'taken' until a payslip has counted it (N2)", async () => {
    const vacation = page.getByTestId("vacation-card");
    // 26 granted − 2 booked = 24, and all of it planned: this user has no payslips at all, so
    // nothing has been counted and nothing was carried over.
    await expect(vacation).toContainText("24");
    await expect(vacation).toContainText("0 d taken");
    await expect(vacation).toContainText("2 d planned");
    await expect(vacation).toContainText("Allowance, less what is taken and planned");

    const rol = page.getByTestId("rol-card");
    // 4 granted days less the half day planned.
    await expect(rol).toContainText("3.5");
    await expect(rol).toContainText("0.5 d planned");
  });

  await test.step("the year's own card adds every kind up", async () => {
    const taken = page.getByTestId("taken-card");
    await expect(taken).toContainText("2.5");
    await expect(taken).toContainText("0 d counted · 2.5 d planned");
    await expect(taken).toContainText("Vacation 2 d");
    await expect(taken).toContainText("ROL 0.5 d");
    // Nobody has stated a total for the year, and the card says so rather than inventing one.
    await expect(taken).toContainText("no total stated");
  });

  await test.step("the calendar draws the year and marks only the days off", async () => {
    await expect(page.getByRole("heading", { name: `${YEAR} calendar` })).toBeVisible();
    await expect(page.getByTestId("leave-cell")).toHaveCount(3);
    // The one sentence that explains the whole control.
    await expect(page.getByText("Pick the first and the last day.")).toBeVisible();
  });

  await test.step("the table groups by month and puts the payslip beside what is recorded (N7)", async () => {
    const rows = page.getByRole("row");
    // Three days, plus a heading per month that holds one, plus the table's own header.
    await expect(rows.filter({ hasText: "No payslip for this month yet" })).not.toHaveCount(0);
    await expect(page.getByRole("row").filter({ hasText: "Vacation" }).first()).toContainText("1 d");
  });

  await test.step("a week of vacation is two clicks and Confirm, and nothing is written before it", async () => {
    const writes = countWrites(page);
    await cell(page, MON).click();
    // The first day is chosen: the bar says so, and offers the two ways out.
    const bar = page.getByTestId("selection-bar");
    await expect(bar).toContainText("pick the last day");
    await expect(bar.getByRole("button", { name: "This day only" })).toBeVisible();
    await expect(bar.getByRole("button", { name: "Cancel" })).toBeVisible();

    await cell(page, FRI).click();
    const panel = page.getByRole("dialog", { name: "New leave" });
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId("summary")).toContainText("5 d (5 working days)");
    // 26 granted − 2 booked = 24 left before; the week takes five of them.
    await expect(panel.getByTestId("summary")).toContainText("24 d → 19 d");
    await panel.getByLabel("Note").fill("a week away");
    await page.waitForTimeout(500);
    expect(writes(), "picking the days and filling the panel writes nothing").toBe(0);

    await panel.getByRole("button", { name: "Confirm" }).click();
    await expect(panel).toBeHidden();
    await expect(page.getByText("Leave saved · 5 d")).toBeVisible();
    expect(writes(), "Confirm is one call").toBe(1);
    for (const date of [MON, TUE, WED, THU, FRI]) {
      await expect(cell(page, date)).toHaveAttribute("data-testid", "leave-cell");
      await expect(rowsOf(page, date).filter({ hasText: "Vacation" })).toHaveCount(1);
    }
    await expect(page.getByTestId("vacation-card")).toContainText("19");
  });

  await test.step("Undo in the toast takes the whole week back, in one call", async () => {
    const writes = countWrites(page);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByText("Undone")).toBeVisible();
    for (const date of [MON, FRI]) await expect(rowsOf(page, date)).toHaveCount(0);
    await expect(page.getByTestId("vacation-card")).toContainText("24");
    expect(writes()).toBe(1);
  });

  await test.step("a range can be dragged with the mouse, and Cancel in the panel writes nothing", async () => {
    const writes = countWrites(page);
    await cell(page, TUE).hover();
    await page.mouse.down();
    await cell(page, WED).hover();
    await cell(page, THU).hover();
    await page.mouse.up();

    const panel = page.getByRole("dialog", { name: "New leave" });
    await expect(panel).toBeVisible();
    await expect(panel.getByLabel("From")).toHaveValue(TUE);
    await expect(panel.getByLabel("To")).toHaveValue(THU);
    // The range stays drawn behind the panel.
    await expect(cell(page, WED)).toHaveAttribute("data-selected", "inside");
    await panel.getByRole("button", { name: "Cancel" }).click();
    await expect(panel).toBeHidden();
    await expect(cell(page, WED)).not.toHaveAttribute("data-selected");
    await expect(page.getByRole("status")).toHaveCount(0);
    expect(writes()).toBe(0);
  });

  await test.step("the right button, a long press and Alt are nobody's shortcut any more", async () => {
    const writes = countWrites(page);
    await cell(page, TUE).click({ button: "right" });
    await cell(page, TUE).hover();
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    // A press let go on the day it began on is a plain click: the first day of a range, no more.
    await expect(page.getByTestId("selection-bar")).toBeVisible();
    await expect(page.getByTestId("leave-panel")).toHaveCount(0);
    await page.getByTestId("selection-bar").getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("selection-bar")).toHaveCount(0);
    await expect(rowsOf(page, TUE)).toHaveCount(0);
    expect(writes()).toBe(0);
  });

  await test.step("half a day and the other half are fields and a button of the panel", async () => {
    await page.getByRole("banner").getByRole("button", { name: "Add leave" }).click();
    const panel = page.getByRole("dialog", { name: "New leave" });
    await panel.getByLabel("From").fill(WED);
    await expect(panel.getByLabel("To")).toHaveValue(WED);
    await panel.getByRole("button", { name: "Half day" }).click();
    await panel.getByLabel("Note").fill("afternoon");
    await expect(panel.getByTestId("summary")).toContainText("0.5 d (1 half day)");
    await panel.getByRole("button", { name: "Confirm" }).click();
    await expect(panel).toBeHidden();
    await expect(page.getByRole("row").filter({ hasText: "afternoon" })).toContainText("0.5 d");
    await expect(cell(page, WED)).toHaveAttribute("data-partial", "true");

    // The booked day opens the same panel, on its row; the other half is one button away.
    await cell(page, WED).click();
    const edit = page.getByRole("dialog", { name: "Edit leave" });
    await expect(edit.getByLabel("Note")).toHaveValue("afternoon");
    await edit.getByRole("button", { name: "Add the other half" }).click();
    const other = page.getByRole("dialog", { name: "New leave" });
    await expect(other.getByLabel("Type")).toHaveValue("rol");
    await other.getByRole("button", { name: "Confirm" }).click();
    await expect(other).toBeHidden();
    // Two halves are a whole day off: both kinds named, and no half-day wedge.
    await expect(cell(page, WED)).toHaveAttribute("aria-label", /Vacation, ROL/);
    await expect(cell(page, WED)).not.toHaveAttribute("data-partial", "true");
    await expect(rowsOf(page, WED)).toHaveCount(2);
  });

  await test.step("a day with two rows asks which one, and Remove takes that one only", async () => {
    await cell(page, WED).click();
    const edit = page.getByRole("dialog", { name: "Edit leave" });
    const which = edit.getByRole("group", { name: "Which leave" });
    await which.getByRole("button", { name: "ROL ½" }).click();
    await expect(edit.getByLabel("Type")).toHaveValue("rol");
    await edit.getByRole("button", { name: "Remove" }).click();
    await expect(edit).toBeHidden();
    await expect(page.getByText("Leave removed")).toBeVisible();
    await expect(rowsOf(page, WED)).toHaveCount(1);
    await expect(rowsOf(page, WED)).toContainText("Vacation");
  });

  await test.step("a range over a booked day says what it replaces before Confirm", async () => {
    await cell(page, TUE).click();
    await cell(page, THU).click();
    const panel = page.getByRole("dialog", { name: "New leave" });
    await panel.getByLabel("Type").selectOption("rol");
    await expect(panel.getByTestId("summary")).toContainText("Replaces");
    await expect(panel.getByTestId("summary")).toContainText("(Vacation ½)");
    // ROL: 4 granted, half a day planned. Three more days leave half a day.
    await expect(panel.getByTestId("summary")).toContainText("3.5 d → 0.5 d");
    await panel.getByRole("button", { name: "Confirm" }).click();
    await expect(panel).toBeHidden();
    await expect(rowsOf(page, WED)).toHaveCount(1);
    await expect(rowsOf(page, WED)).toContainText("ROL");
    await expect(page.getByTestId("rol-card")).toContainText("0.5");
  });

  await test.step("a balance below zero is a number to plan with, not an error", async () => {
    await cell(page, MON).click();
    await cell(page, MON).click();
    const panel = page.getByRole("dialog", { name: "New leave" });
    await panel.getByLabel("Type").selectOption("rol");
    await expect(panel.getByTestId("summary")).toContainText("0.5 d → −0.5 d");
    await expect(panel.getByText(/goes 0.5 d below zero/)).toBeVisible();
    await panel.getByRole("button", { name: "Confirm" }).click();
    await expect(panel).toBeHidden();
    // The card says the same number, and the page lists it among the overdrawn balances.
    await expect(page.getByTestId("rol-card")).toContainText("-0.5");
    await expect(page.getByTestId("overdrawn")).toContainText("ROL");
  });

  await test.step("the table's Remove asks nothing, and its Edit opens the same panel", async () => {
    let asked = false;
    page.on("dialog", (confirm) => {
      asked = true;
      void confirm.accept();
    });
    await rowsOf(page, MON).getByRole("button", { name: "Edit" }).click();
    const edit = page.getByRole("dialog", { name: "Edit leave" });
    await expect(edit.getByLabel("Type")).toHaveValue("rol");
    await edit.getByRole("button", { name: "Cancel" }).click();

    for (const date of [MON, TUE, WED, THU]) {
      await rowsOf(page, date).getByRole("button", { name: "Remove" }).click();
      await expect(rowsOf(page, date)).toHaveCount(0);
    }
    expect(asked, "no browser dialog stands between Remove and the removal").toBe(false);
    await expect(page.getByTestId("overdrawn")).toHaveCount(0);
    await expect(page.getByTestId("rol-card")).toContainText("3.5");
    await expect(page.getByTestId("leave-cell")).toHaveCount(3);
  });

  await test.step("a day still to come is drawn hollow, not as one already counted (N8)", async () => {
    // This user has no payslips, so every booked day is planned — and planned must not look like
    // a day the payroll has already counted.
    const marked = page.getByTestId("leave-cell");
    await expect(marked).not.toHaveCount(0);
    for (const cell of await marked.all()) await expect(cell).toHaveAttribute("data-status", "planned");
    // The legend says what the two drawings mean, since the difference is only a drawing.
    const legend = page.getByTestId("calendar-legend");
    await expect(legend).toContainText("Planned");
    await expect(legend).toContainText("Counted");
  });

  await test.step("a weekend is not even a button: it cannot be booked", async () => {
    // 13 June 2026 is a Saturday.
    await expect(page.locator('button[data-date="2026-06-13"]')).toHaveCount(0);
    await expect(page.locator('[data-date="2026-06-13"]')).toHaveCount(1);
  });

  await test.step("the allowance takes the contract's total, and never asks what last year left over", async () => {
    const tabs = page.getByRole("navigation", { name: "Time off" });
    await tabs.getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/timeoff\/settings/);
    const form = page.locator("form", { has: page.getByLabel("Days granted in total") });
    // The carry-over is the payslip's A.P. since N9: there is no longer a field to type it into,
    // and so no second answer to disagree with the employer's own.
    await expect(form.getByLabel("Carried over from last year")).toHaveCount(0);
    await form.getByLabel("Days granted in total").fill("30");
    await page.getByTestId("unsaved-banner").getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Allowance saved")).toBeVisible();
    await tabs.getByRole("link", { name: "Overview" }).click();

    // 26 + 4 = 30 parts against a 30-day total: they agree, so nothing is said about it.
    await expect(page.getByTestId("taken-card")).toContainText("of 30 d granted");
    // The total is not an allowance of its own: ROL is still its 4 granted days less the half
    // day planned.
    await expect(page.getByTestId("rol-card")).toContainText("3.5");
  });

  await test.step("the year picker moves the whole screen, and the URL with it", async () => {
    await page.goto("/timeoff");
    await page.getByRole("link", { name: "Previous year" }).click();
    await expect(page).toHaveURL(new RegExp(`year=${YEAR - 1}`));
    await expect(page.getByRole("heading", { name: `${YEAR - 1} calendar` })).toBeVisible();
    await expect(page.getByTestId("vacation-card")).toContainText(
      "No payslip and no allowance for this year yet",
    );
    await page.getByRole("link", { name: "This year" }).click();
    await expect(page.getByRole("heading", { name: `${YEAR} calendar` })).toBeVisible();
  });
});

test("the cards say what a month grants, and the panel what will be left on the day (N5.1)", async ({
  page,
}) => {
  await test.step("with no payslip the rate is the allowance over twelve, and the card says so", async () => {
    await page.goto("/timeoff");
    const vacation = page.getByTestId("vacation-card-accrual");
    // 26 days a year over twelve months.
    await expect(vacation).toContainText("Accrues 2.17 d a month");
    // The forecast for the end of the year is the residual of the card: one answer, not two.
    await expect(vacation).toContainText("Forecast on 31 Dec: 24 d");
    await expect(vacation).toContainText("Estimate: the allowance over 12 months");
    await expect(page.getByTestId("rol-card-accrual")).toContainText("Accrues 0.33 d a month");
  });

  await test.step("the panel says the forecast on the first day of the absence, and writes nothing", async () => {
    const writes = countWrites(page);
    await cell(page, MON).click();
    await cell(page, FRI).click();
    const panel = page.getByRole("dialog", { name: "New leave" });
    const summary = panel.getByTestId("summary");
    // The residual of the year stays where it was; the forecast of the day is a line of its own.
    await expect(summary).toContainText("24 d → 19 d");
    await expect(summary).toContainText(`Vacation forecast on ${Number(MON.slice(8))} Mar ${YEAR}`);
    // A week in March against two months of accrual: below zero, said plainly, and still confirmable.
    await expect(panel.getByText(/the Vacation forecast is .* d under zero\. You can confirm/)).toBeVisible();
    await expect(panel.getByRole("button", { name: "Confirm" })).toBeEnabled();
    await panel.getByRole("button", { name: "Cancel" }).click();
    await expect(panel).toBeHidden();
    expect(writes()).toBe(0);
  });

  await test.step("a year with nothing stated has no forecast, and no error", async () => {
    await page.goto(`/timeoff?year=${YEAR + 1}`);
    await expect(page.getByRole("heading", { name: `${YEAR + 1} calendar` })).toBeVisible();
    await expect(page.getByTestId("vacation-card-accrual")).toHaveCount(0);
    await expect(page.getByTestId("vacation-card")).toContainText(
      "No payslip and no allowance for this year yet",
    );
  });
});
