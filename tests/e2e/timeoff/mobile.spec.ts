// tests/e2e/timeoff/mobile.spec.ts — the flow `timeoff` at the width of a phone (400 px: the project
// `mobile` of playwright.config.ts runs every `mobile.spec.ts`).
import { expect, test } from "@playwright/test";
import { sessionState } from "../_shared/env";
import { LAST_YEAR, THIS_YEAR, TODAY } from "../_shared/helpers";

/**
 * Time off at 400 px (plan F7 L2, §11). The screen is a chart, twelve calendars and a table, and
 * the table has six columns — the width worth checking is this one, not the desktop's.
 */
test.describe("time off on a phone", () => {
  // Its own user, with the year of `timeoff`: the journey of the desktop counts that user's days
  // while this file runs. The tests run side by side: the two that book use months of their own.
  test.use({ storageState: sessionState("timeoffPhone") });
  test.describe.configure({ mode: "default" });

  test("shows the cards, the calendar and the table without scrolling sideways", async ({ page }) => {
    await page.goto("/timeoff");
    await expect(page.getByRole("heading", { name: "Work & Time off", level: 1 })).toBeVisible();

    // Time off is not a bottom tab: the bar's fifth cell is More (spec §8.2), so it lives in the
    // sheet, under Work. A fifth tab used to take that cell and clip More onto a second row.
    const tabs = page
      .getByRole("navigation", { name: "Primary" })
      .filter({ has: page.getByRole("button", { name: "More" }) });
    await expect(tabs.getByRole("link", { name: "Time off" })).toBeHidden();
    await tabs.getByRole("button", { name: "More" }).click();
    const sheet = page.getByRole("dialog", { name: "More" });
    await expect(
      sheet.getByRole("group", { name: "Work" }).getByRole("link", { name: "Time off" }),
    ).toHaveAttribute("aria-current", "page");
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    // Both cards in the same unit since N5 — days, ROL included — and the provenance of each.
    await expect(page.getByTestId("vacation-card")).toContainText("days remaining");
    await expect(page.getByTestId("rol-card")).toContainText("days remaining");
    await expect(page.getByTestId("vacation-card")).toContainText("Allowance");
    // And the card that counts the whole year, which a phone has to fit too.
    await expect(page.getByTestId("taken-card")).toContainText("2.5");

    // The twelve calendars are there, and the seeded days are marked.
    await expect(page.getByTestId("leave-cell")).toHaveCount(3);

    // The note and status columns step aside at this width; the status still shows under the date.
    await expect(page.getByRole("columnheader", { name: "Note" })).toBeHidden();
    // A day's own row, not the month heading above it: only a day carries an Edit button.
    const dayRow = page
      .getByRole("row")
      .filter({ has: page.getByRole("button", { name: "Edit" }) })
      .first();
    await expect(dayRow).toContainText(/Taken|Planned/);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("opens this year on this month, where a phone would otherwise start twelve months up (Q5)", async ({
    page,
  }) => {
    await page.goto("/timeoff");
    const month = page.locator(`[data-month="${Number(TODAY.slice(5, 7))}"]`);
    await expect(month).toBeInViewport();
    // And clear of the top bar: the month's name is what was scrolled to.
    const top = (await month.boundingBox())?.y ?? -1;
    const header = (await page.getByRole("banner").boundingBox())?.height ?? 0;
    expect(top).toBeGreaterThanOrEqual(header);

    // Another year has no "this month": it opens at the top, as before.
    await page.goto(`/timeoff?year=${LAST_YEAR}`);
    await expect(page.getByRole("heading", { name: "Work & Time off", level: 1 })).toBeInViewport();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("books with two taps on days a thumb can hit, and the bar stays above the tab bar (N5)", async ({
    page,
  }) => {
    await page.goto("/timeoff");
    let writes = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && request.headers()["next-action"] !== undefined) writes += 1;
    });

    // Every day of the year is at least 40 × 40 px: a button or not, it is drawn the same size.
    // Measured once the grid is laid out: right after the navigation a cell can still measure 0.
    const sizes = () =>
      page
        .locator("[data-date]")
        .evaluateAll((cells) =>
          cells.map((cell) => cell.getBoundingClientRect()).map((box) => [box.width, box.height]),
        );
    await expect
      .poll(async () => Math.min(...(await sizes()).flat().map(Math.round)))
      .toBeGreaterThanOrEqual(40);
    expect(await sizes()).toHaveLength(new Date(THIS_YEAR, 1, 29).getMonth() === 1 ? 366 : 365);

    // Two free days of the month the page opened on, or of the one after it.
    const free = page.locator(`[data-month="3"] [data-testid="free-cell"]`);
    await free.nth(0).scrollIntoViewIfNeeded();
    await free.nth(0).tap();
    const bar = page.getByTestId("selection-bar");
    await expect(bar).toBeVisible();
    await expect(bar).toBeInViewport({ ratio: 1 });
    const tabs = page
      .getByRole("navigation", { name: "Primary" })
      .filter({ has: page.getByRole("button", { name: "More" }) });
    const barBox = await bar.boundingBox();
    const tabsBox = await tabs.boundingBox();
    expect(barBox!.y + barBox!.height).toBeLessThanOrEqual(tabsBox!.y);
    // The bar's two buttons are a thumb's size too.
    for (const name of ["This day only", "Cancel"]) {
      // Rounded: at a phone's scale a 36 px button measures 35.9999.
      const height = (await bar.getByRole("button", { name }).boundingBox())!.height;
      expect(Math.round(height)).toBeGreaterThanOrEqual(36);
    }

    await free.nth(2).tap();
    const panel = page.getByRole("dialog", { name: "New leave" });
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId("summary")).toContainText("3 d (3 working days)");
    // The panel is inside the screen, buttons included.
    const box = await panel.boundingBox();
    const viewport = page.viewportSize()!;
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    await expect(panel.getByRole("button", { name: "Confirm" })).toBeInViewport({ ratio: 1 });
    expect(writes, "two taps and an open panel write nothing").toBe(0);

    await panel.getByRole("button", { name: "Cancel" }).tap();
    await expect(panel).toBeHidden();
    await expect(bar).toHaveCount(0);

    // "Add leave" is on the page itself at this width, with its words.
    await expect(page.getByRole("main").getByRole("button", { name: "Add leave" })).toBeVisible();
    await expect(page.getByRole("banner").getByRole("button", { name: "Add leave" })).toBeHidden();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    expect(writes).toBe(0);
  });

  test("books half vacation and half ROL on a free day with taps, in one step (17/11/2026)", async ({
    page,
  }) => {
    await page.goto("/timeoff");
    const free = page.locator(`[data-month="3"] [data-testid="free-cell"]`);
    await free.nth(0).scrollIntoViewIfNeeded();
    const date = (await free.nth(0).getAttribute("data-date")) as string;
    const day = page.locator(`[data-date="${date}"]`);
    await day.tap();
    await day.tap();
    const panel = page.getByRole("dialog", { name: "New leave" });
    const split = panel.getByRole("button", { name: "Half + half" });
    expect(Math.round((await split.boundingBox())!.height)).toBeGreaterThanOrEqual(32);
    await split.tap();
    await expect(panel.getByLabel("Other half")).toHaveValue("rol");
    const box = await panel.boundingBox();
    const viewport = page.viewportSize()!;
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    const confirm = panel.getByRole("button", { name: "Confirm" });
    await expect(confirm).toBeInViewport({ ratio: 1 });
    await confirm.tap();
    await expect(panel).toBeHidden();
    await expect(day).toHaveAttribute("aria-label", /Vacation, ROL/);

    // As the test found the year: both halves go, one row of the table at a time. The table follows
    // the server, so each removal is over before the next one starts.
    const rows = page
      .getByRole("row")
      .filter({ hasText: `${Number(date.slice(8))} Mar ${date.slice(0, 4)}` });
    await expect(rows).toHaveCount(2);
    for (const left of [1, 0]) {
      await rows.first().getByRole("button", { name: "Remove" }).tap();
      await expect(rows).toHaveCount(left);
    }
    await expect(day).toHaveAttribute("data-testid", "free-cell");
  });

  test("removes several booked days with taps, the list inside the screen (17/11/2026)", async ({ page }) => {
    await page.goto("/timeoff");
    // Not March: the test above books there, side by side with this one.
    const free = page.locator(`[data-month="5"] [data-testid="free-cell"]`);
    await free.nth(0).scrollIntoViewIfNeeded();
    const firstDay = (await free.nth(0).getAttribute("data-date")) as string;
    const lastDay = (await free.nth(1).getAttribute("data-date")) as string;
    const day = (date: string) => page.locator(`[data-date="${date}"]`);
    await day(firstDay).tap();
    await day(lastDay).tap();
    const book = page.getByRole("dialog", { name: "New leave" });
    await book.getByRole("button", { name: "Confirm" }).tap();
    await expect(book).toBeHidden();
    await expect(day(lastDay)).toHaveAttribute("data-testid", "leave-cell");

    await day(firstDay).tap();
    const edit = page.getByRole("dialog", { name: "Edit leave" });
    await edit.getByRole("button", { name: "Select more days from here" }).tap();
    await expect(page.getByTestId("selection-bar")).toBeVisible();
    await day(lastDay).tap();
    await page
      .getByRole("dialog", { name: "New leave" })
      .getByRole("button", { name: "Remove 2 days" })
      .tap();

    const list = page.getByRole("dialog", { name: "Remove leave" });
    const box = await list.boundingBox();
    const viewport = page.viewportSize()!;
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    const remove = list.getByRole("button", { name: "Remove 2 days" });
    await expect(remove).toBeInViewport({ ratio: 1 });
    await remove.tap();

    await expect(day(firstDay)).toHaveAttribute("data-testid", "free-cell");
    await expect(day(lastDay)).toHaveAttribute("data-testid", "free-cell");
    await expect(page.getByText("2 days removed", { exact: true })).toBeVisible();
  });
});
