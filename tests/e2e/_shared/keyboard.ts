// tests/e2e/_shared/keyboard.ts — what the keyboard checks of every flow share
// (tests/e2e/<flow>/keyboard.spec.ts).
//
// The other half of what F9 §12 asks for: a person who never touches
// a mouse can still cross the application. `a11y.spec.ts` measures what a screen looks like; this
// one measures what it does under the keyboard — the command palette, a dialog and its focus trap,
// a row menu, and a sortable table — and that the focus is always drawn where it is.
//
// It runs as the seeded `layout` user, who has something on every page (scripts/seed-e2e.ts): a
// menu with nothing in it traps nothing.
import { expect, type Locator, type Page } from "@playwright/test";
import { hydrated } from "./helpers";

/** What the browser says has the focus, as `tag "name"`. */
export async function focused(page: Page): Promise<string> {
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
export async function focusIsVisible(page: Page): Promise<boolean> {
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

/** The focus goes on a control that already answers. */
export async function focusOn(target: Locator): Promise<void> {
  await hydrated(target);
  await target.focus();
}

/** The dialog on screen has taken the focus: it is open, and its trap is at work. */
export async function dialogHasFocus(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          () => document.querySelector('[role="dialog"]')?.contains(document.activeElement) ?? false,
        ),
      { message: "the dialog did not take the focus" },
    )
    .toBe(true);
}

/** Presses Tab until `stop` says so, at most `limit` times; returns how many it took. */
export async function tabUntil(page: Page, limit: number, stop: () => Promise<boolean>): Promise<number> {
  for (let index = 1; index <= limit; index += 1) {
    await page.keyboard.press("Tab");
    if (await stop()) return index;
  }
  return -1;
}
