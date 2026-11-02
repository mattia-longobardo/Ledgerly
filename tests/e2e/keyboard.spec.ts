// tests/e2e/keyboard.spec.ts — the other half of what F9 §12 asks for: a person who never touches
// a mouse can still cross the application. `a11y.spec.ts` measures what a screen looks like; this
// one measures what it does under the keyboard — the command palette, a dialog and its focus trap,
// a row menu, and a sortable table — and that the focus is always drawn where it is.
//
// It runs as the seeded `layout` user, who has something on every page (scripts/seed-e2e.ts): a
// menu with nothing in it traps nothing.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { FUNDS_HOME_PREVIEW, sessionState } from "./env";

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

test("an investment dialog opened from a row menu traps the focus and gives it back", async ({ page }) => {
  await page.goto("/investments");
  await page.waitForTimeout(500);
  const service = page.getByRole("link", { name: "Directa", exact: true }).filter({ visible: true }).first();
  await page.goto(`${(await service.getAttribute("href"))!.replace(/\?.*$/, "")}/positions`);
  await page.waitForTimeout(500);

  const trigger = page
    .getByRole("button", { name: /^Actions for Vanguard/ })
    .filter({ visible: true })
    .first();
  await trigger.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu").first();
  await expect(menu).toBeVisible();
  await page.keyboard.press("ArrowDown");
  expect(await focusIsVisible(page), "the menu item under the arrows draws no ring").toBe(true);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();

  // "Add operation" (§3.2): a menu behind a button; its "Buy" opens the dialog.
  const opener = page.getByRole("button", { name: "Add operation" }).first();
  await opener.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  // Opened from the keyboard, the menu takes the focus to its first item; the arrows walk on.
  await expect(page.getByRole("menuitem", { name: "Buy", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Deposit", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("menuitem", { name: "Buy", exact: true })).toBeFocused();
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

test.describe("the new Funds home", () => {
  test.skip(!FUNDS_HOME_PREVIEW, "it answers only in a local preview until F5 connects it");
  test.use({ storageState: sessionState("fundsHome") });

  test("the period, the chart's view, a fund's name and its value are walked from the keyboard", async ({
    page,
  }) => {
    await page.goto("/funds/preview");
    await page.waitForTimeout(500);

    const period = page.getByRole("group", { name: "Period", exact: true });
    await period.getByRole("link", { name: "Year" }).focus();
    expect(await focusIsVisible(page), "the Year link draws no ring").toBe(true);
    await page.keyboard.press("Tab");
    await expect(period.getByRole("link", { name: "All" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/funds\/preview\?period=all$/);

    const value = page
      .getByRole("group", { name: "What the chart shows" })
      .getByRole("link", { name: "Value" });
    await value.focus();
    expect(await focusIsVisible(page), "the Value link draws no ring").toBe(true);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/period=all&view=value|view=value&period=all/);

    // The stepper keeps the chart's view from one year to the next.
    await page.goto("/funds/preview?view=value");
    await page.waitForTimeout(500);
    const stepper = page.getByRole("group", { name: "Year", exact: true });
    await stepper.getByRole("link", { name: "Previous year" }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/period=\d{4}/);
    await expect(page).toHaveURL(/view=value/);

    // A row's series toggle, its name and its action are three stops, each with its ring.
    await page.goto("/funds/preview");
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

    const record = row.getByRole("button", { name: "Record value" });
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
    await page.goto("/funds/preview?period=all");
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
  test.skip(!FUNDS_HOME_PREVIEW, "it answers only in a local preview until F5 connects it");
  test.use({ storageState: sessionState("fundsDetail") });

  test("the fund, its tabs, its period and its projection are walked from the keyboard", async ({ page }) => {
    await page.goto("/funds/preview");
    await page.waitForTimeout(500);
    const name = page
      .getByTestId("fund-home-row")
      .filter({ hasText: "Pensione Beta" })
      .getByRole("link", { name: "Pensione Beta" });
    await name.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/funds\/preview\/[0-9a-f-]+$/);
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
    await page.goto("/funds/preview");
    await page.waitForTimeout(500);
    const row = page.getByTestId("fund-home-row").filter({ hasText: "PAC Piano" });
    const href = await row.getByRole("link", { name: "PAC Piano" }).getAttribute("href");
    await page.goto(href!);
    await page.waitForTimeout(500);
    const record = page.getByRole("button", { name: "Record value" }).first();
    await record.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(record, "closing the dialog did not give the focus back").toBeFocused();
  });

  for (const [fund, tab, period] of [
    ["PAC Piano", "Deposits", "deposits"],
    ["PAC Piano", "Valuations", "valuations"],
    ["Pensione Beta", "Contributions", "contributions"],
    ["Pensione Beta", "Valuations", "valuations"],
  ] as const) {
    test(`${fund}: ${tab}, its period and its controls are walked from the keyboard`, async ({ page }) => {
      await page.goto("/funds/preview");
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
        .getByRole("button", { name: /^(Edit|Remove)$/ })
        .first();
      await control.focus();
      expect(await focusIsVisible(page), "the row's control draws no ring").toBe(true);
    });
  }

  test("the edit dialog of a value gives the focus back", async ({ page }) => {
    await page.goto("/funds/preview");
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
