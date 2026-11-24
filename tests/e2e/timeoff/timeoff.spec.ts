// tests/e2e/timeoff/timeoff.spec.ts — the Time off journey at 1440 px (spec §7.9, §11).
//
// Trek stays unlinked throughout: there is no test Trek to talk to, so the screen must stand on
// its own and no pass may be attempted (plan F7 §3.5).
import { type Locator, type Page, expect, test } from "@playwright/test";
import { sessionState } from "../_shared/env";
import { THIS_YEAR } from "../_shared/helpers";

// The tests of this file change the data of one user, each from what the one before left: they run
// in order, on one worker, while the other files run beside them (playwright.preview.config.ts).
test.describe.configure({ mode: "default" });

// Its own user: the four types of before R5g (Vacation, ROL, Time off in lieu, Other), 26 days of
// vacation and 4 days of ROL, one vacation day two weeks back, one three weeks ahead, and half a day
// of ROL a week back (scripts/seed-e2e.ts). No payslips at all: in such a year a day before today is
// taken and the others are planned (R5g, decision 3), and nothing is carried over. No calendar of
// public holidays either: only the working week is known.
test.use({ storageState: sessionState("timeoff") });

const YEAR = THIS_YEAR;

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

/** A Saturday of the year the page shows, whatever the year: the first one of June. */
function firstSaturdayOfJune(): string {
  const day = new Date(Date.UTC(YEAR, 5, 1));
  while (day.getUTCDay() !== 6) day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

const cell = (page: Page, date: string) => page.locator(`[data-date="${date}"]`);
/** The card of one type with an allowance, by the type's name. */
const card = (page: Page, name: string) => page.getByTestId("balance-card").filter({ hasText: name });
/** The type a select of the panel holds, by its name: the value is the type's id. */
const chosen = (select: Locator) => select.locator("option:checked");
/** The rows of the table that are about one of the week's days: "10 Mar 2026". */
const rowsOf = (page: Page, date: string) =>
  page.getByRole("row").filter({ hasText: `${Number(date.slice(8))} Mar ${YEAR}` });

/**
 * Every write this page can make is a call to `/api/v1` that is not a read (rewrite plan R3), so
 * counting those is counting the writes (rewrite plan N5, criterion 3).
 */
function countWrites(page: Page): () => number {
  let writes = 0;
  page.on("request", (request) => {
    if (request.method() !== "GET" && new URL(request.url()).pathname.startsWith("/api/v1/")) writes += 1;
  });
  return () => writes;
}

/** Vacation and ROL granted as the seed states them; saved only when something else was there. */
async function seededAllowances(page: Page): Promise<void> {
  await page.goto("/timeoff/settings");
  const vacation = page.getByLabel("Vacation: days a year");
  const rol = page.getByLabel("ROL: days a year");
  if ((await vacation.inputValue()) === "26" && (await rol.inputValue()) === "4") return;
  await vacation.fill("26");
  await rol.fill("4");
  await page.getByTestId("unsaved-banner").getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Allowance saved").last()).toBeVisible();
}

/**
 * The year as the seed made it, whatever a run stopped half-way left (a run that timed out kept the
 * days it had booked, and the next one counted them): no day of the March week, the seed's allowances.
 */
async function fromTheSeed(page: Page): Promise<void> {
  await seededAllowances(page);
  await page.goto("/timeoff");
  for (const date of [MON, TUE, WED, THU, FRI]) {
    for (let left = await rowsOf(page, date).count(); left > 0; left -= 1) {
      await rowsOf(page, date).first().getByRole("button", { name: "Remove" }).click();
      await expect(rowsOf(page, date)).toHaveCount(left - 1);
    }
  }
}

test("time off counts the year, says where each number comes from, and refuses a day nobody works", async ({
  page,
}) => {
  // One long journey: under four workers it needs more than the default 30 seconds.
  test.slow();
  await fromTheSeed(page);
  await test.step("the allowance of each type reads in one unit — days (N5, R5g)", async () => {
    await page.goto("/timeoff");
    await expect(page.getByRole("heading", { name: "Work & Time off", level: 1 })).toBeVisible();
    await expect(page.getByText("Vacation: 26 d · ROL: 4 d")).toBeVisible();
    // Nothing is carried over: no payslip prints it, and nobody stated it.
    await expect(page.getByText("carried over")).toHaveCount(0);
    // No calendar of public holidays: the page says that only the working week is known.
    await expect(page.getByTestId("no-holiday-calendar")).toContainText("Only your working week is known");
  });

  await test.step("in a year with no payslip a day before today is taken (R5g, decision 3)", async () => {
    // One card per type with an allowance: the two of the seed, and none for the other two.
    await expect(page.getByTestId("balance-card")).toHaveCount(2);
    const vacation = card(page, "Vacation");
    // 26 granted − 2 booked = 24: the day two weeks back is taken, the one ahead planned.
    await expect(vacation).toContainText("24");
    await expect(vacation).toContainText("1 d taken");
    await expect(vacation).toContainText("1 d planned");
    await expect(vacation).toContainText("Allowance, less what is taken and planned");

    const rol = card(page, "ROL");
    // 4 granted days less the half day of a week ago.
    await expect(rol).toContainText("3.5");
    await expect(rol).toContainText("0.5 d taken");
  });

  await test.step("the year's own card adds every type up", async () => {
    const taken = page.getByTestId("taken-card");
    await expect(taken).toContainText("2.5");
    await expect(taken).toContainText("1.5 d counted · 1 d planned");
    await expect(taken).toContainText("Vacation 2 d");
    await expect(taken).toContainText("ROL 0.5 d");
    // What the types with an allowance grant together: 26 + 4.
    await expect(taken).toContainText("of 30 d granted");
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
    await expect(card(page, "Vacation")).toContainText("19");
  });

  await test.step("Undo in the toast takes the whole week back, in one call", async () => {
    const writes = countWrites(page);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByText("Undone")).toBeVisible();
    for (const date of [MON, FRI]) await expect(rowsOf(page, date)).toHaveCount(0);
    await expect(card(page, "Vacation")).toContainText("24");
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
    await expect(chosen(other.getByLabel("Type"))).toHaveText("ROL");
    await other.getByRole("button", { name: "Confirm" }).click();
    await expect(other).toBeHidden();
    // Two halves are a whole day off: both types named, and no half-day wedge.
    await expect(cell(page, WED)).toHaveAttribute("aria-label", /Vacation, ROL/);
    await expect(cell(page, WED)).not.toHaveAttribute("data-partial", "true");
    await expect(rowsOf(page, WED)).toHaveCount(2);
  });

  await test.step("a day with two rows asks which one, and Remove takes that one only", async () => {
    await cell(page, WED).click();
    const edit = page.getByRole("dialog", { name: "Edit leave" });
    const which = edit.getByRole("group", { name: "Which leave" });
    await which.getByRole("button", { name: "ROL ½" }).click();
    await expect(chosen(edit.getByLabel("Type"))).toHaveText("ROL");
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
    await panel.getByLabel("Type").selectOption({ label: "ROL" });
    await expect(panel.getByTestId("summary")).toContainText("Replaces");
    await expect(panel.getByTestId("summary")).toContainText("(Vacation ½)");
    // ROL: 4 granted, half a day taken. Three more days leave half a day.
    await expect(panel.getByTestId("summary")).toContainText("3.5 d → 0.5 d");
    await panel.getByRole("button", { name: "Confirm" }).click();
    await expect(panel).toBeHidden();
    await expect(rowsOf(page, WED)).toHaveCount(1);
    await expect(rowsOf(page, WED)).toContainText("ROL");
    await expect(card(page, "ROL")).toContainText("0.5");
  });

  await test.step("a balance below zero is a number to plan with, not an error", async () => {
    await cell(page, MON).click();
    await cell(page, MON).click();
    const panel = page.getByRole("dialog", { name: "New leave" });
    await panel.getByLabel("Type").selectOption({ label: "ROL" });
    await expect(panel.getByTestId("summary")).toContainText("0.5 d → −0.5 d");
    await expect(panel.getByText(/goes 0.5 d below zero/)).toBeVisible();
    await panel.getByRole("button", { name: "Confirm" }).click();
    await expect(panel).toBeHidden();
    // The card says the same number, and the page lists it among the overdrawn balances.
    await expect(card(page, "ROL")).toContainText("-0.5");
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
    await expect(chosen(edit.getByLabel("Type"))).toHaveText("ROL");
    await edit.getByRole("button", { name: "Cancel" }).click();

    for (const date of [MON, TUE, WED, THU]) {
      await rowsOf(page, date).getByRole("button", { name: "Remove" }).click();
      await expect(rowsOf(page, date)).toHaveCount(0);
    }
    expect(asked, "no browser dialog stands between Remove and the removal").toBe(false);
    await expect(page.getByTestId("overdrawn")).toHaveCount(0);
    await expect(card(page, "ROL")).toContainText("3.5");
    await expect(page.getByTestId("leave-cell")).toHaveCount(3);
  });

  await test.step("several booked days go together: one action, the list, one Undo (17/11/2026)", async () => {
    await cell(page, TUE).click();
    await cell(page, THU).click();
    const book = page.getByRole("dialog", { name: "New leave" });
    await book.getByRole("button", { name: "Confirm" }).click();
    await expect(book).toBeHidden();
    await expect(page.getByTestId("leave-cell")).toHaveCount(6);
    // The server's rows have arrived (as the step below waits for Friday's): a booked day opens its
    // own panel only from them, and under load they come after the calendar is drawn.
    for (const date of [TUE, WED, THU]) await expect(rowsOf(page, date)).toHaveCount(1);
    const writes = countWrites(page);

    // A booked day still opens its own panel; the visible control makes it the first day.
    await cell(page, TUE).click();
    const edit = page.getByRole("dialog", { name: "Edit leave" });
    await edit.getByRole("button", { name: "Select more days from here" }).click();
    await expect(edit).toBeHidden();
    await expect(page.getByTestId("selection-bar")).toBeVisible();
    await cell(page, THU).click();
    const panel = page.getByRole("dialog", { name: "New leave" });
    await panel.getByRole("button", { name: "Remove 3 days" }).click();
    const list = page.getByRole("dialog", { name: "Remove leave" });
    await expect(list.getByRole("listitem")).toHaveCount(3);
    expect(writes(), "the list comes before anything is written").toBe(0);
    await list.getByRole("button", { name: "Remove 3 days" }).click();

    for (const date of [TUE, WED, THU])
      await expect(cell(page, date)).toHaveAttribute("data-testid", "free-cell");
    await expect(page.getByText("3 days removed", { exact: true })).toBeVisible();
    for (const date of [TUE, WED, THU]) await expect(rowsOf(page, date)).toHaveCount(0);
    expect(writes()).toBe(1);

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByText("Undone")).toBeVisible();
    for (const date of [TUE, WED, THU]) await expect(rowsOf(page, date)).toHaveCount(1);
    await expect(page.getByTestId("leave-cell")).toHaveCount(6);

    // As the step found the year: the three days go again, this time from a free day before them.
    await cell(page, MON).click();
    await cell(page, THU).click();
    await page
      .getByRole("dialog", { name: "New leave" })
      .getByRole("button", { name: "Remove 3 days" })
      .click();
    await page
      .getByRole("dialog", { name: "Remove leave" })
      .getByRole("button", { name: "Remove 3 days" })
      .click();
    await expect(page.getByTestId("leave-cell")).toHaveCount(3);
  });

  await test.step("a whole day of vacation becomes half vacation and half ROL in one step (17/11/2026)", async () => {
    await cell(page, FRI).click();
    await cell(page, FRI).click();
    const book = page.getByRole("dialog", { name: "New leave" });
    await book.getByRole("button", { name: "Confirm" }).click();
    await expect(book).toBeHidden();
    await expect(rowsOf(page, FRI)).toHaveCount(1);
    const writes = countWrites(page);

    await cell(page, FRI).click();
    const edit = page.getByRole("dialog", { name: "Edit leave" });
    await edit.getByRole("button", { name: "Half + half" }).click();
    await expect(chosen(edit.getByLabel("Other half"))).toHaveText("ROL");
    await expect(edit.getByTestId("summary")).toContainText("1 d (1 day: Vacation ½ + ROL ½)");
    await expect(edit.getByTestId("summary")).toContainText("3.5 d → 3 d");
    await edit.getByRole("button", { name: "Confirm" }).click();
    await expect(edit).toBeHidden();

    await expect(cell(page, FRI)).toHaveAttribute("aria-label", /Vacation, ROL/);
    await expect(cell(page, FRI)).not.toHaveAttribute("data-partial", "true");
    await expect(rowsOf(page, FRI)).toHaveCount(2);
    await expect(card(page, "ROL")).toContainText("3");
    expect(writes(), "one Confirm, one write").toBe(1);

    // As the step found the year.
    for (const left of [1, 0]) {
      await rowsOf(page, FRI).first().getByRole("button", { name: "Remove" }).click();
      await expect(rowsOf(page, FRI)).toHaveCount(left);
    }
  });

  await test.step("a day still to come is drawn hollow, not as one already counted (N8)", async () => {
    // This user has no payslips: the two days before today are taken, the one ahead is planned —
    // and planned must not look like a day already counted.
    const marked = page.getByTestId("leave-cell");
    await expect(marked).toHaveCount(3);
    await expect(marked.and(page.locator('[data-status="planned"]'))).toHaveCount(1);
    await expect(marked.and(page.locator('[data-status="taken"]'))).toHaveCount(2);
    // The legend says what the two drawings mean, since the difference is only a drawing.
    const legend = page.getByTestId("calendar-legend");
    await expect(legend).toContainText("Planned");
    await expect(legend).toContainText("Counted");
  });

  await test.step("a weekend is not even a button: it cannot be booked", async () => {
    const saturday = firstSaturdayOfJune();
    await expect(page.locator(`button[data-date="${saturday}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-date="${saturday}"]`)).toHaveCount(1);
  });

  await test.step("the allowance is stated type by type, with a carry-over where no payslip prints one", async () => {
    const tabs = page.getByRole("navigation", { name: "Time off" });
    await tabs.getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/timeoff\/settings/);
    // The seed's four types, and an allowance field only for the two that have one.
    await expect(page.getByTestId("leave-types").getByRole("listitem")).toHaveCount(4);
    await expect(page.getByLabel("Time off in lieu: days a year")).toHaveCount(0);
    await page.getByLabel("Vacation: days a year").fill("28");
    await page.getByLabel("Vacation: carried over").fill("1");
    await page.getByTestId("unsaved-banner").getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Allowance saved").last()).toBeVisible();
    await tabs.getByRole("link", { name: "Overview" }).click();

    // 28 granted and 1 carried over, less the 2 booked; the total granted follows.
    await expect(page.getByText("Vacation: 28 d")).toBeVisible();
    await expect(card(page, "Vacation")).toContainText("27");
    await expect(page.getByTestId("taken-card")).toContainText("of 32 d granted");
    // ROL is its own: still its 4 granted days less the half day taken.
    await expect(card(page, "ROL")).toContainText("3.5");

    // As the step found the year: the seed's allowance and no carry-over.
    await tabs.getByRole("link", { name: "Settings" }).click();
    await page.getByLabel("Vacation: days a year").fill("26");
    await page.getByLabel("Vacation: carried over").fill("");
    await page.getByTestId("unsaved-banner").getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Allowance saved").last()).toBeVisible();
  });

  await test.step("the year picker moves the whole screen, and the URL with it", async () => {
    await page.goto("/timeoff");
    await page.getByRole("link", { name: "Previous year" }).click();
    await expect(page).toHaveURL(new RegExp(`year=${YEAR - 1}`));
    await expect(page.getByRole("heading", { name: `${YEAR - 1} calendar` })).toBeVisible();
    await expect(card(page, "Vacation")).toContainText("No payslip and no allowance for this year yet");
    await page.getByRole("link", { name: "This year" }).click();
    await expect(page.getByRole("heading", { name: `${YEAR} calendar` })).toBeVisible();
  });
});

test("the cards say what a month grants, and the panel what will be left on the day (N5.1)", async ({
  page,
}) => {
  await fromTheSeed(page);
  await test.step("with no payslip the rate is the allowance over twelve, and the card says so", async () => {
    await page.goto("/timeoff");
    const vacation = card(page, "Vacation").getByTestId("balance-card-accrual");
    // 26 days a year over twelve months.
    await expect(vacation).toContainText("Accrues 2.17 d a month");
    // The forecast for the end of the year is the residual of the card: one answer, not two.
    await expect(vacation).toContainText("Forecast at the end of the leave year: 24 d");
    await expect(vacation).toContainText("Estimate: the allowance over 12 months");
    await expect(card(page, "ROL").getByTestId("balance-card-accrual")).toContainText(
      "Accrues 0.33 d a month",
    );
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
    await expect(card(page, "Vacation").getByTestId("balance-card-accrual")).toHaveCount(0);
    await expect(card(page, "Vacation")).toContainText("No payslip and no allowance for this year yet");
  });
});
