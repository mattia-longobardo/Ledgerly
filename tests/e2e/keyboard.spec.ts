// tests/e2e/keyboard.spec.ts — the other half of what F9 §12 asks for: a person who never touches
// a mouse can still cross the application. `a11y.spec.ts` measures what a screen looks like; this
// one measures what it does under the keyboard — the command palette, a dialog and its focus trap,
// a row menu, and a sortable table — and that the focus is always drawn where it is.
//
// It runs as the seeded `layout` user, who has something on every page (scripts/seed-e2e.ts): a
// menu with nothing in it traps nothing.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { sessionState } from "./env";

test.use({ storageState: sessionState("layout") });

/** What the browser says has the focus, as `tag "name"`. */
async function focused(page: Page): Promise<string> {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!element) return "none";
    const name =
      element.getAttribute("aria-label") ?? (element.textContent ?? "").trim().replace(/\s+/g, " ");
    return `${element.tagName.toLowerCase()} "${name.slice(0, 40)}"`;
  });
}

/**
 * The focused element draws a ring. `focus-ring` is `outline: 2px solid var(--accent)`, so an
 * outline of at least 1 px that is not `none` is the whole test: a control that can be reached and
 * not seen is a control nobody can use.
 */
async function focusIsVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body) return false;
    const style = getComputedStyle(element);
    const width = Number.parseFloat(style.outlineWidth);
    if (style.outlineStyle !== "none" && width >= 1) return true;
    // A few controls draw the ring as a shadow instead; either is a ring.
    return style.boxShadow !== "none";
  });
}

/** Presses Tab until `stop` says so, at most `limit` times; returns how many it took. */
async function tabUntil(page: Page, limit: number, stop: () => Promise<boolean>): Promise<number> {
  for (let index = 1; index <= limit; index += 1) {
    await page.keyboard.press("Tab");
    if (await stop()) return index;
  }
  return -1;
}

test("the command palette opens, filters, moves and goes, all from the keyboard", async ({ page }) => {
  await page.goto("/");
  await page.waitForTimeout(500);

  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog");
  await expect(palette).toBeVisible();
  // It takes the focus on its own: a palette you have to Tab into is not a shortcut.
  await expect(palette.getByRole("combobox")).toBeFocused();

  await page.keyboard.type("budg");
  const options = palette.getByRole("option");
  await expect(options.first()).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/budgets$/);

  // Escape closes it, and closing it gives the page back.
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("a dialog takes the focus, keeps it, and gives it back", async ({ page }) => {
  await page.goto("/pockets");
  await page.waitForTimeout(500);

  const opener = page.getByRole("button", { name: "New pocket" }).first();
  await opener.focus();
  expect(await focusIsVisible(page), "the button that opens the dialog draws no ring").toBe(true);
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(300);

  // Tab goes round inside: after enough presses the focus is still in the dialog, never on a
  // control of the page behind it. Base UI wraps the popup in `data-base-ui-focus-guard`
  // sentinels and the focus crosses them — and `<body>` — on its way round; those are how the
  // trap works, not a way out, so they are the only stops allowed outside.
  const held = () =>
    page.evaluate(() => {
      const element = document.activeElement;
      if (!element) return false;
      if (document.querySelector('[role="dialog"]')?.contains(element)) return true;
      return element === document.body || element.hasAttribute("data-base-ui-focus-guard");
    });
  let ringsSeen = 0;
  for (let index = 0; index < 25; index += 1) {
    await page.keyboard.press("Tab");
    expect(await held(), `Tab ${index + 1} left the dialog: focus on ${await focused(page)}`).toBe(true);
    if (await focusIsVisible(page)) ringsSeen += 1;
  }
  expect(ringsSeen, "nothing inside the dialog ever drew a ring").toBeGreaterThan(0);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener, "closing the dialog did not give the focus back").toBeFocused();
});

test("a row menu opens on Enter, walks with the arrows and closes on Escape", async ({ page }) => {
  await page.goto("/expenses");
  await page.waitForTimeout(800);

  const trigger = page.getByRole("button", { name: /Actions|Row actions|More/ }).first();
  await trigger.focus();
  await page.keyboard.press("Enter");

  const menu = page.getByRole("menu").first();
  await expect(menu).toBeVisible();
  await page.keyboard.press("ArrowDown");
  const first = await focused(page);
  await page.keyboard.press("ArrowDown");
  expect(await focused(page), "the arrows do not move inside the menu").not.toBe(first);
  expect(await focusIsVisible(page), "the menu item under the arrows draws no ring").toBe(true);

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("the update value dialog of a manual service traps the focus and gives it back", async ({ page }) => {
  await page.goto("/investments");
  await page.waitForTimeout(500);
  const service = page.getByRole("link", { name: "Directa", exact: true }).filter({ visible: true }).first();
  // A manual service has one command (PERS-342): "Update value", the balance of its account.
  await page.goto((await service.getAttribute("href"))!.replace(/\?.*$/, ""));
  await page.waitForTimeout(500);

  const opener = page.getByRole("button", { name: "Update value" }).first();
  await opener.focus();
  expect(await focusIsVisible(page), "the button that opens the dialog draws no ring").toBe(true);
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(300);
  for (let index = 0; index < 20; index += 1) {
    await page.keyboard.press("Tab");
    const held = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element) return false;
      if (document.querySelector('[role="dialog"]')?.contains(element)) return true;
      return element === document.body || element.hasAttribute("data-base-ui-focus-guard");
    });
    expect(held, `Tab ${index + 1} left the dialog: focus on ${await focused(page)}`).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener, "closing the dialog did not give the focus back").toBeFocused();
});

test("the replace key dialog of a connected service traps the focus and gives it back", async ({ page }) => {
  await page.goto("/investments");
  await page.waitForTimeout(500);
  const service = page.getByRole("link", { name: "eToro", exact: true }).filter({ visible: true }).first();
  await page.goto(`${(await service.getAttribute("href"))!.replace(/\?.*$/, "")}/connection`);
  await page.waitForTimeout(500);

  const opener = page.getByRole("button", { name: "Replace key" }).first();
  await opener.focus();
  expect(await focusIsVisible(page), "the button that opens the dialog draws no ring").toBe(true);
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(300);
  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press("Tab");
    const held = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element) return false;
      if (document.querySelector('[role="dialog"]')?.contains(element)) return true;
      return element === document.body || element.hasAttribute("data-base-ui-focus-guard");
    });
    expect(held, `Tab ${index + 1} left the dialog: focus on ${await focused(page)}`).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener, "closing the dialog did not give the focus back").toBeFocused();
});

test("a service's tabs are walked from the keyboard, each one a page, the period kept", async ({ page }) => {
  await page.goto("/investments?period=all");
  await page.waitForTimeout(500);
  const service = page.getByRole("link", { name: "eToro", exact: true }).filter({ visible: true }).first();
  await page.goto((await service.getAttribute("href"))!);
  await page.waitForTimeout(500);

  const tabs = page.getByRole("navigation", { name: "Sections of the service" });
  const names = ["Overview", "Positions", "Activity", "Connection"];
  await tabs.getByRole("link", { name: "Overview" }).focus();
  expect(await focusIsVisible(page), "the tab draws no ring").toBe(true);
  for (const name of names.slice(1)) {
    await page.keyboard.press("Tab");
    await expect(tabs.getByRole("link", { name: new RegExp(`^${name}`) })).toBeFocused();
    expect(await focusIsVisible(page), `the ${name} tab draws no ring`).toBe(true);
  }
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/connection\?period=all$/);
  await expect(tabs.getByRole("link", { name: /^Connection/ })).toHaveAttribute("aria-current", "page");
});

test("Positions: the open, closed and all-closed views are links walked from the keyboard (§3.4)", async ({
  page,
}) => {
  await page.goto("/investments?period=all");
  await page.waitForTimeout(500);
  const service = page.getByRole("link", { name: "eToro", exact: true }).filter({ visible: true }).first();
  await page.goto(`${(await service.getAttribute("href"))!.replace(/\?.*$/, "")}/positions?period=all`);
  await page.waitForTimeout(500);

  const status = page.getByRole("group", { name: "Which positions" });
  await status.getByRole("link", { name: /^Open/ }).focus();
  expect(await focusIsVisible(page), "the Open link draws no ring").toBe(true);
  await page.keyboard.press("Tab");
  await expect(status.getByRole("link", { name: /^Closed in/ })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(status.getByRole("link", { name: /^All closed/ })).toBeFocused();
  expect(await focusIsVisible(page), "the All closed link draws no ring").toBe(true);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/positions\?period=all&status=all$/);
  await expect(status.getByRole("link", { name: /^All closed/ })).toHaveAttribute("aria-current", "true");
  // A row's asset opens its Activity: a link of its own, apart from the row.
  const asset = page.getByTestId("closed-row").first().getByRole("link").first();
  await asset.focus();
  expect(await focusIsVisible(page), "the asset link draws no ring").toBe(true);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/activity\?period=all&asset=/);
});

test("a sortable table sorts from the keyboard, and the column says which way", async ({ page }) => {
  await page.goto("/expenses");
  await page.waitForTimeout(800);

  const header: Locator = page.getByRole("columnheader").filter({ hasText: "Amount" }).first();
  const button = header.getByRole("button").first();
  await button.focus();
  expect(await focusIsVisible(page), "the sort control draws no ring").toBe(true);

  const before = await header.getAttribute("aria-sort");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(600);
  const after = await page
    .getByRole("columnheader")
    .filter({ hasText: "Amount" })
    .first()
    .getAttribute("aria-sort");
  expect(after, "Enter on the header changed no sort").not.toBe(before);
});

test("the sidebar, the page and its controls are reachable in order from the top", async ({ page }) => {
  await page.goto("/accounts");
  await page.waitForTimeout(800);
  await page.evaluate(() => document.body.focus());

  // A "skip to content" is not in this design; what matters is that Tab from the top reaches the
  // page's own first control without a dead end, and that every stop on the way draws a ring.
  const steps = await tabUntil(page, 40, async () => {
    if (!(await focusIsVisible(page))) {
      throw new Error(`focus with no ring on ${await focused(page)}`);
    }
    return (await focused(page)).includes("ING Conto Arancio");
  });
  expect(steps, "the first account link was not reached within 40 tabs").toBeGreaterThan(0);
});

test("Time off: a range is picked, confirmed, removed and undone without a mouse (rewrite plan N5)", async ({
  page,
}) => {
  const year = new Date().getFullYear();
  await page.goto("/timeoff");
  await page.waitForTimeout(500);
  const focusedDate = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.date);
  const bar = page.getByTestId("selection-bar");
  // One Remove button per booked row: counting them is counting the rows, whatever the seed holds.
  const removes = page.getByRole("table").getByRole("button", { name: "Remove" });
  const seeded = await removes.count();
  expect(seeded).toBeGreaterThan(0);

  // Into March from one of its days, then to the month's last day that can be booked.
  await page.locator(`[data-month="3"] button[data-date]`).first().focus();
  await page.keyboard.press("End");
  await expect.poll(focusedDate).toMatch(new RegExp(`^${year}-03-`));
  const first = (await focusedDate()) as string;
  expect(await focusIsVisible(page)).toBe(true);

  await test.step("Escape drops a range that has only its first day, and the focus stays", async () => {
    await page.keyboard.press("Enter");
    await expect(bar).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(bar).toHaveCount(0);
    expect(await focusedDate()).toBe(first);
  });

  await test.step("Enter, an arrow into the next month, Enter: the panel opens on the range", async () => {
    await page.keyboard.press("Enter");
    await expect(bar).toBeVisible();
    // The arrow leaves March: a range may run across two months, so the arrows do too.
    await page.keyboard.press("ArrowRight");
    await expect.poll(focusedDate).toMatch(new RegExp(`^${year}-04-`));
    expect(await focusIsVisible(page)).toBe(true);
    await expect(page.locator(`[data-date="${first}"]`)).toHaveAttribute("data-selected", "edge");
    await page.keyboard.press("Enter");

    const panel = page.getByRole("dialog", { name: "New leave" });
    await expect(panel).toBeVisible();
    await expect(panel.getByLabel("From")).toBeFocused();
    await expect(panel.getByLabel("From")).toHaveValue(first);
    await expect(panel.getByTestId("summary")).toContainText("2 d (2 working days)");
  });

  const last = await page.getByRole("dialog", { name: "New leave" }).getByLabel("To").inputValue();

  await test.step("Enter in a field confirms, and the focus goes back to the day", async () => {
    await page.keyboard.press("Enter");
    // By its name: a toast is a dialog too, and one is about to appear.
    await expect(page.getByRole("dialog", { name: "New leave" })).toHaveCount(0);
    await expect(page.getByText("Leave saved · 2 d")).toBeVisible();
    await expect(page.locator(`[data-date="${first}"]`)).toHaveAttribute("data-testid", "leave-cell");
    await expect(removes).toHaveCount(seeded + 2);
    await expect.poll(focusedDate).toBe(last);
  });

  await test.step("Delete removes a booked day, and F6 reaches Undo in the toast", async () => {
    await page.keyboard.press("Delete");
    await expect(page.getByText("Leave removed")).toBeVisible();
    await expect(removes).toHaveCount(seeded + 1);

    await page.keyboard.press("F6");
    await tabUntil(page, 4, async () => (await focused(page)) === 'button "Undo"');
    expect(await focused(page)).toBe('button "Undo"');
    expect(await focusIsVisible(page)).toBe(true);
    await page.keyboard.press("Enter");
    await expect(page.getByText("Undone")).toBeVisible();
    await expect(removes).toHaveCount(seeded + 2);
  });

  await test.step("the two days go again, so the next spec finds the year as the seed left it", async () => {
    for (const [index, date] of [first, last].entries()) {
      await page.locator(`[data-date="${date}"]`).focus();
      await page.keyboard.press("Delete");
      await expect(removes).toHaveCount(seeded + 1 - index);
    }
  });
});

test.describe("the Funds home", () => {
  test.use({ storageState: sessionState("fundsHome") });

  test("the period, the chart's view, a fund's name and its value are walked from the keyboard", async ({
    page,
  }) => {
    await page.goto("/funds");
    await page.waitForTimeout(500);

    const period = page.getByRole("group", { name: "Period", exact: true });
    await period.getByRole("link", { name: "Year" }).focus();
    expect(await focusIsVisible(page), "the Year link draws no ring").toBe(true);
    await page.keyboard.press("Tab");
    await expect(period.getByRole("link", { name: "All" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/funds\?period=all$/);

    const value = page
      .getByRole("group", { name: "What the chart shows" })
      .getByRole("link", { name: "Value" });
    await value.focus();
    expect(await focusIsVisible(page), "the Value link draws no ring").toBe(true);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/period=all&view=value|view=value&period=all/);

    // The stepper keeps the chart's view from one year to the next.
    await page.goto("/funds?view=value");
    await page.waitForTimeout(500);
    const stepper = page.getByRole("group", { name: "Year", exact: true });
    await stepper.getByRole("link", { name: "Previous year" }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/period=\d{4}/);
    await expect(page).toHaveURL(/view=value/);

    // A row's series toggle, its name and its action are three stops, each with its ring.
    await page.goto("/funds");
    await page.waitForTimeout(500);
    const row = page.getByTestId("fund-home-row").filter({ hasText: "PAC Beta" });
    const toggle = row.getByRole("button", { name: /Highlight PAC Beta/ });
    await toggle.focus();
    expect(await focusIsVisible(page), "the series toggle draws no ring").toBe(true);
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Tab");
    await expect(row.getByRole("link", { name: "PAC Beta" })).toBeFocused();
    expect(await focusIsVisible(page), "the fund's name draws no ring").toBe(true);

    const record = row.getByRole("button", { name: "Update value" });
    await record.focus();
    expect(await focusIsVisible(page), "the action draws no ring").toBe(true);
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(record, "closing the dialog did not give the focus back").toBeFocused();
  });

  test("a year of Year by year opens from the keyboard", async ({ page }) => {
    await page.goto("/funds?period=all");
    await page.waitForTimeout(500);
    const year = new Date().getFullYear() - 3;
    const link = page
      .getByTestId("year-row")
      .getByRole("link", { name: `Open ${year}` })
      .first();
    await link.focus();
    expect(await focusIsVisible(page), "the year's link draws no ring").toBe(true);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`period=${year}$`));
  });
});

test.describe("a fund's new page", () => {
  test.use({ storageState: sessionState("fundsDetail") });

  test("the fund, its tabs, its period and its projection are walked from the keyboard", async ({ page }) => {
    await page.goto("/funds");
    await page.waitForTimeout(500);
    const name = page
      .getByTestId("fund-home-row")
      .filter({ hasText: "Pensione Beta" })
      .getByRole("link", { name: "Pensione Beta" });
    await name.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/funds\/[0-9a-f-]+$/);
    await page.waitForTimeout(500);

    const period = page.getByRole("group", { name: "Period", exact: true });
    const all = period.getByRole("link", { name: "All" });
    await all.focus();
    expect(await focusIsVisible(page), "the All link draws no ring").toBe(true);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/period=all$/);

    const tabs = page.getByRole("navigation", { name: "Fund" });
    const contributions = tabs.getByRole("link", { name: "Contributions" });
    await contributions.focus();
    expect(await focusIsVisible(page), "the tab draws no ring").toBe(true);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/tab=contributions/);
    await expect(page).toHaveURL(/period=all/);

    await tabs.getByRole("link", { name: "Overview" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("fund-projection")).toBeVisible();
    const summary = page.getByTestId("fund-projection").locator("summary");
    await summary.focus();
    expect(await focusIsVisible(page), "the projection draws no ring").toBe(true);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("fund-projection")).toHaveAttribute("open", "");
  });

  test("the valuation dialog gives the focus back", async ({ page }) => {
    await page.goto("/funds");
    await page.waitForTimeout(500);
    const row = page.getByTestId("fund-home-row").filter({ hasText: "PAC Piano" });
    const href = await row.getByRole("link", { name: "PAC Piano" }).getAttribute("href");
    await page.goto(href!);
    await page.waitForTimeout(500);
    const record = page.getByRole("button", { name: "Update value" }).first();
    await record.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(record, "closing the dialog did not give the focus back").toBeFocused();
  });

  for (const [fund, tab, period] of [
    ["PAC Piano", "Contributions", "contributions"],
    ["PAC Piano", "Values", "valuations"],
    ["Pensione Beta", "Contributions", "contributions"],
    ["Pensione Beta", "Values", "valuations"],
  ] as const) {
    test(`${fund}: ${tab}, its period and its controls are walked from the keyboard`, async ({ page }) => {
      await page.goto("/funds");
      await page.waitForTimeout(500);
      const href = await page
        .getByTestId("fund-home-row")
        .filter({ hasText: fund })
        .getByRole("link", { name: fund })
        .getAttribute("href");
      await page.goto(href!);
      await page.waitForTimeout(500);

      const link = page.getByRole("navigation", { name: "Fund" }).getByRole("link", { name: tab });
      await link.focus();
      expect(await focusIsVisible(page), "the tab draws no ring").toBe(true);
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(new RegExp(`tab=${period}`));

      const all = page.getByRole("group", { name: "Period", exact: true }).getByRole("link", { name: "All" });
      await all.focus();
      expect(await focusIsVisible(page), "the All link draws no ring").toBe(true);
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(new RegExp(`tab=${period}.*period=all|period=all.*tab=${period}`));
      await page.waitForTimeout(500);

      const control = page
        .locator("main")
        .getByRole("button", { name: /^(Edit|Delete)( the contribution of .+)?$/ })
        .first();
      await control.focus();
      expect(await focusIsVisible(page), "the row's control draws no ring").toBe(true);
    });
  }

  test("the edit dialog of a value gives the focus back", async ({ page }) => {
    await page.goto("/funds");
    await page.waitForTimeout(500);
    const href = await page
      .getByTestId("fund-home-row")
      .filter({ hasText: "PAC Piano" })
      .getByRole("link", { name: "PAC Piano" })
      .getAttribute("href");
    await page.goto(`${href}?tab=valuations&period=all`);
    await page.waitForTimeout(500);
    const edit = page.getByTestId("valuation-line").first().getByRole("button", { name: "Edit" });
    await edit.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
});

// Release N6 (docs/design/rewrite-plan/ux/n6-pension-fund.md §17.1): the four dialogs of a fund and the
// form that creates one, as the seeded `layout` user, whose "Cometa" is fed by the payslip and whose
// "Fideuram Master Selection" has a debit and two fees.
test.describe("a fund's dialogs and the form that creates one", () => {
  /** A tab of one of `layout`'s funds, by the fund's name. */
  async function openFund(page: Page, name: string, query: string): Promise<void> {
    await page.goto("/funds?period=all");
    await page.waitForTimeout(500);
    const href = await page
      .getByTestId("fund-home-row")
      .filter({ hasText: name })
      .getByRole("link", { name })
      .getAttribute("href");
    await page.goto(`${href!.split("?")[0]}${query}`);
    await page.waitForTimeout(500);
  }

  /** Still in the dialog, or on one of the stops Base UI's trap crosses on its way round. */
  const held = (page: Page) =>
    page.evaluate(() => {
      const element = document.activeElement;
      if (!element) return false;
      if (document.querySelector('[role="dialog"]')?.contains(element)) return true;
      return element === document.body || element.hasAttribute("data-base-ui-focus-guard");
    });

  /**
   * The dialog on screen keeps the focus through a whole round of Tab, draws a ring on what it
   * holds, closes on Escape and gives the focus back to `opener`.
   */
  async function trapsAndGivesBack(page: Page, opener: Locator, title: RegExp): Promise<void> {
    const dialog = page.getByRole("dialog", { name: title });
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(300);
    expect(await held(page), `the dialog did not take the focus: ${await focused(page)}`).toBe(true);
    let ringsSeen = 0;
    for (let index = 0; index < 25; index += 1) {
      await page.keyboard.press("Tab");
      expect(await held(page), `Tab ${index + 1} left the dialog: focus on ${await focused(page)}`).toBe(
        true,
      );
      if (await focusIsVisible(page)) ringsSeen += 1;
    }
    expect(ringsSeen, "nothing inside the dialog ever drew a ring").toBeGreaterThan(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener, "closing the dialog did not give the focus back").toBeFocused();
  }

  test("the contribution dialog traps the focus, closes on Escape and gives the focus back", async ({
    page,
  }) => {
    await openFund(page, "Cometa", "?tab=contributions&period=all");
    const opener = page
      .getByTestId("fund-contributions")
      .getByRole("button", { name: "Record contribution" });
    await opener.focus();
    expect(await focusIsVisible(page), "the button that opens the dialog draws no ring").toBe(true);
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: /^Record contribution/ });
    await expect(dialog).toBeVisible();
    // The kind is chosen with the keyboard too: Enter on a segment presses it, and the fields follow.
    const other = dialog.getByRole("button", { name: "Other operation" });
    await other.focus();
    expect(await focusIsVisible(page), "the kind draws no ring").toBe(true);
    await page.keyboard.press("Enter");
    await expect(other).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.getByLabel("Operation")).toBeVisible();
    // Space ticks "I do not know the fee", which switches the fee field off.
    const unknown = dialog.getByRole("checkbox", { name: "I do not know the fee" });
    await unknown.focus();
    await page.keyboard.press("Space");
    await expect(unknown).toBeChecked();
    await expect(dialog.getByLabel("Fee", { exact: true })).toBeDisabled();
    await trapsAndGivesBack(page, opener, /^Record contribution/);
  });

  test("the value dialog traps the focus, closes on Escape and gives the focus back", async ({ page }) => {
    await openFund(page, "Fideuram Master Selection", "");
    const opener = page.getByRole("banner").getByRole("button", { name: "Update value" });
    await opener.focus();
    expect(await focusIsVisible(page), "the button that opens the dialog draws no ring").toBe(true);
    await page.keyboard.press("Enter");
    await trapsAndGivesBack(page, opener, /^Update value/);
  });

  test("the source dialog traps the focus, from Edit and from the Add source menu, and gives it back", async ({
    page,
  }) => {
    await openFund(page, "Cometa", "?tab=settings");
    const edit = page.getByRole("button", { name: "Edit Payslip" });
    await edit.focus();
    expect(await focusIsVisible(page), "Edit draws no ring").toBe(true);
    await page.keyboard.press("Enter");
    // The switch of the due date is a stop of the dialog, with its ring, and Space turns it.
    const due = page.getByRole("dialog").getByRole("switch", { name: "The transfer has a due date" });
    await due.focus();
    expect(await focusIsVisible(page), "the switch draws no ring").toBe(true);
    const was = await due.getAttribute("aria-checked");
    await page.keyboard.press("Space");
    await expect(due).not.toHaveAttribute("aria-checked", was!);
    await expect(due).toBeFocused();
    await trapsAndGivesBack(page, edit, /^Payslip$/);

    // From the menu: the arrows walk it, Enter opens the dialog, and Escape gives the focus to the
    // button the menu hangs from.
    const add = page.getByTestId("fund-sources").getByRole("button", { name: "Add source" });
    await add.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu", { name: "Add source" })).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitem", { name: "Recurring debit" })).toBeFocused();
    await page.keyboard.press("Enter");
    await trapsAndGivesBack(page, add, /^Recurring debit$/);

    // A source's own menu closes on Escape and gives the focus back.
    const actions = page.getByRole("button", { name: "Actions for Payslip" });
    await actions.focus();
    expect(await focusIsVisible(page), "the source's menu draws no ring").toBe(true);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toBeHidden();
    await expect(actions).toBeFocused();
  });

  test("the fee dialog traps the focus, from Add and from Edit, and gives it back", async ({ page }) => {
    await openFund(page, "Fideuram Master Selection", "?tab=settings");
    const add = page.getByTestId("fund-fees").getByRole("button", { name: "Add fee" });
    await add.focus();
    expect(await focusIsVisible(page), "Add fee draws no ring").toBe(true);
    await page.keyboard.press("Enter");
    await trapsAndGivesBack(page, add, /^Add fee$/);

    const edit = page
      .getByTestId("fund-fees")
      .getByRole("button", { name: "Edit Management" })
      .filter({ visible: true });
    await edit.focus();
    expect(await focusIsVisible(page), "a fee's Edit draws no ring").toBe(true);
    await page.keyboard.press("Enter");
    await trapsAndGivesBack(page, edit, /^Edit fee$/);
  });

  test("the form: every stop draws a ring, a step gives the focus to its heading, Escape does nothing", async ({
    page,
  }) => {
    await page.goto("/funds/new");
    await page.waitForTimeout(500);
    const form = page.getByTestId("fund-wizard");
    const step = (name: string) => page.getByTestId(`wizard-step-${name}`);

    // Step 1: its fields, "Advanced" and the two commands, in the order of the page.
    const name = form.getByLabel("Name");
    await name.focus();
    expect(await focusIsVisible(page), "the name draws no ring").toBe(true);
    await page.keyboard.type("Fondo Tastiera");
    const advanced = step("fund").locator("summary");
    await advanced.focus();
    expect(await focusIsVisible(page), "Advanced draws no ring").toBe(true);
    await page.keyboard.press("Enter");
    await expect(form.getByLabel("Code")).toBeVisible();
    await form.getByLabel("Member since").focus();
    // The year is typed a digit at a time: a date half written is no date yet, and breaks nothing.
    await page.keyboard.type(`0301${new Date().getFullYear() - 1}`);
    await expect(step("fund")).toBeVisible();
    await page.keyboard.press("Enter");

    // Step 2: the heading has the focus, the step done is a link with its ring, a switch turns on Space.
    await expect(page).toHaveURL(/step=sources$/);
    await expect(page.getByRole("heading", { name: "How you pay in", level: 2 })).toBeFocused();
    const done = page.getByRole("list", { name: "Steps" }).getByRole("link", { name: /The fund/ });
    await done.focus();
    expect(await focusIsVisible(page), "the step done draws no ring").toBe(true);
    const debit = page.getByTestId("source-switch-bank_debit");
    await debit.focus();
    expect(await focusIsVisible(page), "the switch draws no ring").toBe(true);
    await page.keyboard.press("Space");
    await expect(debit).toHaveAttribute("aria-checked", "true");
    await expect(debit, "the switch lost the focus").toBeFocused();
    // The fields it opens are the next stops.
    await page.keyboard.press("Tab");
    await expect(step("sources").getByLabel("Expected amount")).toBeFocused();
    // Enter with the amount missing: the message, and the focus on the field.
    await page.keyboard.press("Enter");
    await expect(step("sources")).toContainText("Enter the expected amount.");
    await expect(step("sources").getByLabel("Expected amount")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(step("sources")).toBeVisible();
    await page.keyboard.type("100");
    await step("sources").getByLabel("Payee contains").focus();
    await page.keyboard.type("Esempio");
    await page.keyboard.press("Enter");

    // Step 3: the fee dialog opens and closes from the keyboard, and gives the focus back.
    await expect(page).toHaveURL(/step=fees$/);
    await expect(page.getByRole("heading", { name: "Fees", level: 2 })).toBeFocused();
    const add = step("fees").getByRole("button", { name: "Add fee" });
    await add.focus();
    await page.keyboard.press("Enter");
    await trapsAndGivesBack(page, add, /^Add fee$/);
    const skip = step("fees").getByRole("button", { name: "Skip for now" });
    await skip.focus();
    expect(await focusIsVisible(page), "the step's command draws no ring").toBe(true);
    await page.keyboard.press("Enter");

    // Step 4: the heading again; "Back" goes a step back and nothing was written.
    await expect(page).toHaveURL(/step=review$/);
    await expect(page.getByRole("heading", { name: "Summary", level: 2 })).toBeFocused();
    const back = step("review").getByRole("button", { name: "Back" });
    await back.focus();
    expect(await focusIsVisible(page), "Back draws no ring").toBe(true);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/step=fees$/);
    await expect(page.getByRole("heading", { name: "Fees", level: 2 })).toBeFocused();
  });
});
