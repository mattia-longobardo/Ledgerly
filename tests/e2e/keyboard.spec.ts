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
