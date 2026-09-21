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

/** The press the calendar reads as "make this half a day": down, wait past the threshold, up. */
async function hold(page: Page, date: string, button: "left" | "right" = "left"): Promise<void> {
  const cell = page.locator(`[data-date="${date}"]`);
  await cell.hover();
  await page.mouse.down({ button });
  await page.waitForTimeout(700);
  await page.mouse.up({ button });
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
    await expect(
      page.getByText("Hold the right button instead for half vacation and half ROL"),
    ).toBeVisible();
  });

  await test.step("the table groups by month and puts the payslip beside what is recorded (N7)", async () => {
    const rows = page.getByRole("row");
    // Three days, plus a heading per month that holds one, plus the table's own header.
    await expect(rows.filter({ hasText: "No payslip for this month yet" })).not.toHaveCount(0);
    await expect(page.getByRole("row").filter({ hasText: "Vacation" }).first()).toContainText("1 d");
  });

  await test.step("one click books a day, another makes it ROL, the right button clears it (N3)", async () => {
    const free = page.locator(`button[data-date="${YEAR}-03-10"]`);
    await expect(free).toHaveCount(1);

    await free.click();
    await expect(page.locator(`[data-date="${YEAR}-03-10"][data-testid="leave-cell"]`)).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "Vacation" })).not.toHaveCount(0);

    // A second click walks it on to ROL, without a dialog ever appearing.
    await page.locator(`[data-date="${YEAR}-03-10"]`).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page
        .getByRole("row")
        .filter({ hasText: `10 Mar ${YEAR}` })
        .filter({ hasText: "ROL" }),
    ).toHaveCount(1);

    // The right button takes it away again.
    await page.locator(`[data-date="${YEAR}-03-10"]`).click({ button: "right" });
    await expect(page.getByRole("row").filter({ hasText: `10 Mar ${YEAR}` })).toHaveCount(0);
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

  await test.step("holding a booked day down makes it half a day, and holding again a whole one (N8)", async () => {
    const day = page.locator(`button[data-date="${YEAR}-03-12"]`);
    await day.click();
    await expect(page.locator(`[data-date="${YEAR}-03-12"][data-testid="leave-cell"]`)).toBeVisible();

    await hold(page, `${YEAR}-03-12`);
    await expect(page.locator(`[data-date="${YEAR}-03-12"][data-partial="true"]`)).toBeVisible();
    await expect(
      page
        .getByRole("row")
        .filter({ hasText: `12 Mar ${YEAR}` })
        .filter({ hasText: "0.5 d" }),
    ).toHaveCount(1);

    await hold(page, `${YEAR}-03-12`);
    await expect(page.locator(`[data-date="${YEAR}-03-12"][data-partial="true"]`)).toHaveCount(0);

    await page.locator(`[data-date="${YEAR}-03-12"]`).click({ button: "right" });
    await expect(page.getByRole("row").filter({ hasText: `12 Mar ${YEAR}` })).toHaveCount(0);
  });

  await test.step("holding the right button makes a day half vacation and half ROL (N10)", async () => {
    const date = `${YEAR}-03-13`;
    await hold(page, date, "right");
    // Two kinds on one date is the shape no click can reach, so it has a gesture of its own. The
    // day is not "partial": two halves still add up to a day off, and the cell says so by naming
    // both kinds rather than by wearing the half-day wedge.
    const cell = page.locator(`[data-date="${date}"]`);
    await expect(cell).toHaveAttribute("aria-label", /Vacation/);
    await expect(cell).toHaveAttribute("aria-label", /ROL/);
    await expect(cell).not.toHaveAttribute("data-partial", "true");
    const rows = page.getByRole("row").filter({ hasText: `13 Mar ${YEAR}` });
    await expect(rows.filter({ hasText: "Vacation" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "ROL" })).toHaveCount(1);

    // Held again it is a whole day of vacation once more: a gesture you cannot undo is one
    // nobody dares try.
    await hold(page, date, "right");
    await expect(page.getByRole("row").filter({ hasText: `13 Mar ${YEAR}` })).toHaveCount(1);

    // And a quick right-click still takes the day away, as it always did.
    await page.locator(`[data-date="${date}"]`).click({ button: "right" });
    await expect(page.getByRole("row").filter({ hasText: `13 Mar ${YEAR}` })).toHaveCount(0);
  });

  await test.step("a weekend is not even a button: it cannot be booked", async () => {
    // 13 June 2026 is a Saturday.
    await expect(page.locator('button[data-date="2026-06-13"]')).toHaveCount(0);
    await expect(page.locator('[data-date="2026-06-13"]')).toHaveCount(1);
  });

  await test.step("a held click opens the dialog, which is the way to half a day", async () => {
    await page.locator(`button[data-date="${YEAR}-03-11"]`).click({ modifiers: ["Alt"] });
    const dialog = page.getByRole("dialog", { name: "Add leave" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Duration").selectOption("0.5");
    await dialog.getByLabel("Note").fill("afternoon");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();

    const row = page.getByRole("row").filter({ hasText: "afternoon" });
    await expect(row).toContainText("0.5 d");
    await expect(page.locator(`[data-date="${YEAR}-03-11"][data-partial="true"]`)).toBeVisible();
  });

  await test.step("a booked day can still be edited from the table", async () => {
    page.once("dialog", (confirm) => confirm.accept());
    await page
      .getByRole("row")
      .filter({ hasText: "afternoon" })
      .getByRole("button", { name: "Remove" })
      .click();
    await expect(page.getByRole("row").filter({ hasText: "afternoon" })).toHaveCount(0);
  });

  await test.step("the allowance takes the contract's total, and never asks what last year left over", async () => {
    await page.getByRole("button", { name: "Allowance" }).click();
    const dialog = page.getByRole("dialog", { name: `Allowance for ${YEAR}` });
    // The carry-over is the payslip's A.P. since N9: there is no longer a field to type it into,
    // and so no second answer to disagree with the employer's own.
    await expect(dialog.getByLabel("Carried over from last year")).toHaveCount(0);
    await dialog.getByLabel("Days granted in total").fill("30");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();

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
