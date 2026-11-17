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
  // while this file runs. One test here books a day, so the three run in order.
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
    const sizes = await page
      .locator("[data-date]")
      .evaluateAll((cells) =>
        cells.map((cell) => cell.getBoundingClientRect()).map((box) => [box.width, box.height]),
      );
    expect(sizes).toHaveLength(new Date(THIS_YEAR, 1, 29).getMonth() === 1 ? 366 : 365);
    for (const [width, height] of sizes) {
      expect(Math.round(width)).toBeGreaterThanOrEqual(40);
      expect(Math.round(height)).toBeGreaterThanOrEqual(40);
    }

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
});
