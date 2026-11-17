// tests/e2e/shell/keyboard.spec.ts — the keyboard checks of the flow `shell`; what the
// keyboard checks of every flow share is in tests/e2e/_shared/keyboard.ts.
import { expect, test } from "@playwright/test";
import { dialogHasFocus, focused, focusIsVisible, focusOn, tabUntil } from "../_shared/keyboard";
import { sessionState } from "../_shared/env";
import { hydrated } from "../_shared/helpers";

test.use({ storageState: sessionState("layout") });

test("the command palette opens, filters, moves and goes, all from the keyboard @smoke", async ({ page }) => {
  await page.goto("/");

  // The shortcut is a listener of the shell: pressed before the shell answers, it is lost. Pressed
  // again until the palette is there — never a second time once it is, which would close it.
  const palette = page.getByRole("dialog");
  await expect(async () => {
    await page.keyboard.press("Control+k");
    await expect(palette).toBeVisible({ timeout: 2_000 });
  }).toPass();
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

  const opener = page.getByRole("button", { name: "New pocket" }).first();
  await focusOn(opener);
  expect(await focusIsVisible(page), "the button that opens the dialog draws no ring").toBe(true);
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialogHasFocus(page);

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

test("the sidebar, the page and its controls are reachable in order from the top", async ({ page }) => {
  await page.goto("/accounts");
  // The list of the accounts is on the page, and answers, before the walk starts from the top.
  await hydrated(page.getByRole("link", { name: "ING Conto Arancio" }).filter({ visible: true }).first());
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
