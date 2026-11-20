// tests/e2e/categories/keyboard.spec.ts — Expenses › Categories without a mouse
// (categories-and-rules.md §8): a group opens and closes on Enter and Space, the row's menu walks
// with the arrows and gives the focus back, renaming is left with Escape, and the macro switches.
// Nothing here writes: the `review` user is read by the screen check too.
import { expect, test } from "@playwright/test";
import { focused, focusIsVisible, focusOn } from "../_shared/keyboard";
import { sessionState } from "../_shared/env";
import { hydrated } from "../_shared/helpers";

test.use({ storageState: sessionState("review") });

test("Expenses › Categories: a group, its menu, renaming and the macros, from the keyboard", async ({
  page,
}) => {
  await page.goto("/expenses/categories?preset=last3Months");
  // The accounts menu is a popover since UI-EXP-3 (Mattia, 20/11/2026), a closed button too: the
  // first group is looked for in the board, past it.
  const group = page.locator("main section").getByRole("button", { expanded: false }).first();
  await hydrated(group);
  const name = (await group.textContent())?.trim() ?? "";

  await test.step("Enter opens a group and Space closes it, with the ring drawn", async () => {
    await focusOn(group);
    await page.keyboard.press("Enter");
    const toggle = page.getByRole("button", { name, exact: true });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(await focusIsVisible(page)).toBe(true);
    await page.keyboard.press("Space");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  await test.step("the row's menu walks with the arrows, and Escape gives the focus back", async () => {
    const trigger = page.getByRole("button", { name: `Actions for ${name}`, exact: true });
    await focusOn(trigger);
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await page.keyboard.press("ArrowDown");
    const first = await focused(page);
    await page.keyboard.press("ArrowDown");
    expect(await focused(page)).not.toBe(first);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  await test.step("Rename puts the name in a field, and Escape leaves it as it was", async () => {
    const trigger = page.getByRole("button", { name: `Actions for ${name}`, exact: true });
    await focusOn(trigger);
    await page.keyboard.press("Enter");
    await page.getByRole("menuitem", { name: "Rename" }).focus();
    await page.keyboard.press("Enter");
    const field = page.getByRole("textbox", { name: `Name of ${name}` });
    await expect(field).toBeFocused();
    await expect(field).toHaveValue(name);
    await page.keyboard.press("Escape");
    await expect(field).toHaveCount(0);
    await expect(page.getByRole("button", { name, exact: true })).toBeFocused();
  });

  await test.step("the macros switch from the keyboard", async () => {
    const income = page
      .getByRole("group", { name: "Section" })
      .getByRole("button", { name: "Income", exact: true });
    await focusOn(income);
    await page.keyboard.press("Enter");
    await expect(income).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("heading", { name: "Income", level: 2 })).toBeVisible();
    await expect(page).toHaveURL(/macro=income/);
  });
});
