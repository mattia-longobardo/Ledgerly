// tests/e2e/mobile.spec.ts
import { expect, type Page, test } from "@playwright/test";
import { sessionState, USERS } from "./env";
import { LAST_YEAR, previewClient, signInWithPassword, THIS_YEAR, TODAY } from "./helpers";

test.use({ extraHTTPHeaders: previewClient(3) });

test("phones get bottom tabs and a More sheet instead of the sidebar @site", async ({ page }) => {
  await signInWithPassword(page, USERS.owner.email, USERS.owner.password);
  const tabs = page
    .getByRole("navigation", { name: "Primary" })
    .filter({ has: page.getByRole("button", { name: "More" }) });
  await expect(tabs.getByRole("link", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("Ledgerly", { exact: true })).toBeHidden();
  await tabs.getByRole("button", { name: "More" }).click();
  const sheet = page.getByRole("dialog", { name: "More" });
  await expect(
    sheet.getByRole("group", { name: "System" }).getByRole("link", { name: "Settings" }),
  ).toBeVisible();
  // The sheet sits above the tab bar instead of covering it (the open modal hides the bar from the
  // accessibility tree, so it is found by its markup here).
  const bar = await page
    .locator("nav", { has: page.locator('button[aria-haspopup="dialog"]') })
    .boundingBox();
  await expect
    .poll(async () => {
      const box = await sheet.boundingBox();
      return box && box.y + box.height;
    })
    .toBe(bar!.y);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  // Accounts is one of the bottom tabs, and its page fits a 400 px screen without sideways
  // scrolling (spec §8.2). Checked inside this test rather than its own: the run's password
  // sign-ins are all spoken for (tests/e2e/env.ts).
  await tabs.getByRole("link", { name: "Accounts" }).click();
  await expect(page).toHaveURL("/accounts");
  await expect(page.getByRole("heading", { name: "No accounts yet" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  await tabs.getByRole("button", { name: "More" }).click();
  await page.getByRole("dialog", { name: "More" }).getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
});

/**
 * The F2 journey at 400 px (spec §11). Its own user, from the seed's session, so it costs none of
 * the run's rate-limited sign-ins (tests/e2e/env.ts) and has movements to show.
 */
test.describe("expenses on a phone", () => {
  test.use({ storageState: sessionState("expenses") });

  test("the table is shown as a list and fits the screen", async ({ page }) => {
    await page.goto("/expenses");
    await expect(page.getByRole("heading", { name: "Expenses" }).first()).toBeVisible();

    // §8.2: below 768 px the table becomes a list. The table itself is hidden, so its column
    // headers are gone from the accessibility tree and the movements are list items.
    await expect(page.getByRole("columnheader", { name: "Payee" })).toBeHidden();
    const rows = page.getByRole("listitem").filter({ hasText: "Esselunga" });
    await expect(rows.first()).toBeVisible();
    await expect(rows.first()).toContainText("45,50 €");

    // No sideways scrolling, the same bar §8.2 sets for Accounts.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // Expenses is one of the bottom tabs of the design.
    const tabs = page
      .getByRole("navigation", { name: "Primary" })
      .filter({ has: page.getByRole("button", { name: "More" }) });
    await expect(tabs.getByRole("link", { name: "Expenses" })).toBeVisible();
  });
});

/** The Budgets journey at 400 px (spec §8.2, §11): the table becomes a list and fits the screen. */
test.describe("budgets on a phone", () => {
  test.use({ storageState: sessionState("budgets") });

  test("the budgets are a list reachable from the More sheet", async ({ page }) => {
    await page.goto("/");
    const tabs = page
      .getByRole("navigation", { name: "Primary" })
      .filter({ has: page.getByRole("button", { name: "More" }) });
    await tabs.getByRole("button", { name: "More" }).click();
    await page.getByRole("dialog", { name: "More" }).getByRole("link", { name: "Budgets" }).click();
    await expect(page).toHaveURL("/budgets");

    await expect(page.getByRole("columnheader", { name: "Budget" })).toBeHidden();
    await expect(page.getByTestId("budget-item").filter({ hasText: "Spesa" })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

/** The Pockets pages at 400 px (spec §8.2, §11): the cards, then a pocket's page, nothing sideways. */
test.describe("pockets on a phone", () => {
  test.use({ storageState: sessionState("pockets") });

  test("the cards lead to the pocket's page and both fit the screen", async ({ page }) => {
    const overflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.goto("/pockets");
    await expect(page.getByTestId("pocket-card").first()).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.getByTestId("pocket-card").filter({ hasText: "Holidays" }).click();
    await expect(page.getByTestId("pocket-detail")).toBeVisible();
    await expect(page.getByTestId("pocket-expenses")).toContainText("Ischia");
    expect(await overflow()).toBeLessThanOrEqual(0);
  });
});

/** The Subscriptions page at 400 px (spec §8.2, §11): the table becomes a list. */
test.describe("subscriptions on a phone", () => {
  test.use({ storageState: sessionState("subscriptions") });

  test("the subscriptions are a list and the page fits the screen", async ({ page }) => {
    await page.goto("/subscriptions");
    // The top bar keeps the primary action inside the screen; the suggestions move into the page.
    const add = page.getByRole("button", { name: "Add subscription" });
    await expect(add).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole("button", { name: /Suggest from recurring payments/ })).toBeInViewport();
    await expect(page.getByRole("columnheader", { name: "Billing" })).toBeHidden();
    await expect(page.getByTestId("subscription-item").filter({ hasText: "Netflix" })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

/** Interests at 400 px (spec §8.2, §11): the rules are a list and the page fits. */
test.describe("interests on a phone", () => {
  test.use({ storageState: sessionState("interests") });

  test("the page fits the screen", async ({ page }) => {
    await page.goto("/interests");
    await expect(page.getByRole("heading", { name: "Interests" }).first()).toBeAttached();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

/** Funds at 400 px (spec §8.2, §11): the page fits the screen. */
test.describe("funds on a phone", () => {
  test.use({ storageState: sessionState("funds") });

  test("the page fits the screen", async ({ page }) => {
    await page.goto("/funds");
    await expect(page.getByRole("heading", { name: "Funds" }).first()).toBeAttached();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

/**
 * The pension fund of release N6 at 400 px (docs/design/rewrite-plan/ux/n6-pension-fund.md §11.1): the form
 * that creates a fund, and a fund's page with its one set of tabs. Seeded sessions: no password sign-in.
 */
test.describe("the form of a fund on a phone", () => {
  test.use({ storageState: sessionState("fundsSetup") });

  const overflow = (page: Page) =>
    page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  test("each step fits the screen, with the step's command first and as wide as the card", async ({
    page,
  }) => {
    await page.goto("/funds/new");
    const form = page.getByTestId("fund-wizard");
    const card = (name: string) => page.getByTestId(`wizard-step-${name}`);
    const steps = page.getByRole("list", { name: "Steps" });
    // Under 480 px a step that is not the current one shows its number alone; its name stays for a reader.
    await expect(steps.locator('[aria-current="step"]')).toContainText("The fund");
    await expect(steps.getByText("How you pay in")).toHaveClass(/sr-only/);
    expect(await overflow(page)).toBeLessThanOrEqual(0);

    /** The primary command sits above the other one, and both are as wide as the card's content. */
    const stacked = async (name: string, primary: string, other: string) => {
      const first = await card(name).getByRole("button", { name: primary }).boundingBox();
      const second = await card(name)
        .getByRole("button", { name: other })
        .or(card(name).getByRole("link", { name: other }))
        .boundingBox();
      expect(first!.y, `${primary} is not above ${other}`).toBeLessThan(second!.y);
      expect(first!.width, `${primary} is not full width`).toBeGreaterThan(300);
      expect(Math.abs(first!.width - second!.width)).toBeLessThanOrEqual(1);
    };

    await form.getByLabel("Name").fill("Fondo Telefono");
    await form.getByLabel("Member since").fill(`${LAST_YEAR}-03-01`);
    await stacked("fund", "Continue", "Cancel");
    await card("fund").getByRole("button", { name: "Continue" }).click();

    // Every source switched on: the rows with a switch are tall enough for a thumb, and nothing overflows.
    for (const kind of ["payroll", "bank_debit", "manual"]) {
      const toggle = page.getByTestId(`source-switch-${kind}`);
      await toggle.tap();
      await expect(toggle).toHaveAttribute("aria-checked", "true");
      // The row is the nearest ancestor that has a box of its own: a wrapper may be `display: contents`.
      const height = await toggle.evaluate((element) => {
        let row = element.parentElement;
        while (row && row.getBoundingClientRect().height === 0) row = row.parentElement;
        return row?.getBoundingClientRect().height ?? 0;
      });
      expect(height, `the row of ${kind} is under 44 px`).toBeGreaterThanOrEqual(44);
    }
    await expect(steps.locator('[aria-current="step"]')).toContainText("How you pay in");
    await expect(steps.getByText("The fund")).toHaveClass(/sr-only/);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await stacked("sources", "Continue", "Back");
    // Nothing is created: the journey stops here, and leaving asks first.
    await page.getByTestId("source-switch-bank_debit").tap();
    await page.getByTestId("source-switch-payroll").tap();
    await card("sources").getByRole("button", { name: "Continue" }).click();
    await expect(card("fees")).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await stacked("fees", "Skip for now", "Back");
    await card("fees").getByRole("button", { name: "Skip for now" }).click();
    await expect(card("review")).toContainText("One-off payments");
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await stacked("review", "Create fund", "Back");
  });
});

test.describe("a fund's page on a phone", () => {
  test.use({ storageState: sessionState("fundsDetail") });

  for (const fund of ["PAC Piano", "Pensione Beta"]) {
    test(`${fund}: the four tabs are on one row, and no tab scrolls the page sideways`, async ({ page }) => {
      await page.goto("/funds?preset=all");
      const href = await page
        .getByTestId("fund-home-item")
        .filter({ hasText: fund })
        .getByRole("link", { name: fund })
        .getAttribute("href");
      const path = href!.split("?")[0];
      await page.goto(path);
      const tabs = page.getByRole("navigation", { name: "Fund" });
      const tops: number[] = [];
      for (const name of ["Overview", "Contributions", "Values", "Settings"]) {
        const box = await tabs.getByRole("link", { name }).boundingBox();
        tops.push(box!.y);
      }
      // The current tab sits a pixel lower than the others; a second row would be a whole line down.
      expect(Math.max(...tops) - Math.min(...tops), "the tabs wrap onto a second row").toBeLessThan(8);
      // "Update value" stays in the top bar; no fund kind, no "Deductible" and nothing to import anywhere.
      await expect(page.getByRole("banner").getByRole("button", { name: "Update value" })).toBeVisible();
      for (const tab of ["overview", "contributions", "valuations", "settings"]) {
        await page.goto(`${path}?tab=${tab}&preset=all`);
        await expect(page.getByRole("heading", { name: fund, level: 1 })).toBeVisible();
        const sideways = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(sideways, `${tab} scrolls sideways`).toBeLessThanOrEqual(0);
        await expect(page.getByTestId("kpi-deductible"), tab).toHaveCount(0);
        await expect(page.getByRole("button", { name: /Import/ }), tab).toHaveCount(0);
      }
      // The register is a list here, with the same commands as the table of a wide screen.
      await page.goto(`${path}?tab=contributions&preset=all`);
      await expect(page.getByTestId("contribution-item").first()).toBeVisible();
      await expect(page.getByTestId("contribution-row").first()).toBeHidden();
      await expect(
        page.getByTestId("fund-contributions").getByRole("button", { name: "Record contribution" }),
      ).toBeVisible();
    });
  }
});

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
