// tests/e2e/categories/rules.spec.ts — Settings › Rules with the keyboard only
// (categories-and-rules.md §4, §8; release N3.4): create a rule, put it higher in the order, apply
// a rule to the movements already here and undo that. The `rulesJourney` user is a copy of the
// user the screen check measures; the journey leaves it with one rule more.
import { expect, type Page, test } from "@playwright/test";
import { sessionState } from "../_shared/env";
import { dialogHasFocus, focusOn } from "../_shared/keyboard";

test.describe.configure({ mode: "serial" });
test.use({ storageState: sessionState("rulesJourney") });

const rows = (page: Page) => page.getByTestId("rule-row");
const row = (page: Page, name: string) => rows(page).filter({ hasText: name });

async function menuItem(page: Page, rule: string, item: string) {
  const trigger = page.getByRole("button", { name: `Actions for ${rule}`, exact: true });
  await focusOn(trigger);
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: item }).focus();
  await page.keyboard.press("Enter");
}

test("a rule made, ordered, applied and undone with the keyboard", async ({ page }) => {
  await page.goto("/settings/rules");
  await expect(rows(page)).toHaveCount(2);

  await test.step("New rule: name, condition, category, preview, Save", async () => {
    await focusOn(page.getByRole("button", { name: "New rule" }).first());
    await page.keyboard.press("Enter");
    await dialogHasFocus(page);
    const editor = page.getByRole("dialog", { name: "New rule" });
    await expect(editor.getByRole("textbox", { name: "Name" })).toBeFocused();
    await page.keyboard.type("Trains");
    await editor.getByRole("textbox", { name: "Value" }).focus();
    await page.keyboard.type("trenitalia");
    await editor.getByRole("button", { name: /^Category:/ }).focus();
    await page.keyboard.press("Enter");
    await page.keyboard.type("Corner shop");
    await page.keyboard.press("Enter");
    await expect(editor.getByRole("button", { name: "Category: Corner shop" })).toBeVisible();
    await expect(editor.getByTestId("rule-preview")).toContainText("1 transaction matches.");
    await editor.getByRole("button", { name: "Save" }).focus();
    await page.keyboard.press("Enter");
    await expect(editor).toBeHidden();
    await expect(rows(page)).toHaveCount(3);
    await expect(rows(page).nth(2)).toContainText("Trains");
    await expect(rows(page).nth(2)).toContainText("Text contains «trenitalia»");
  });

  await test.step("Move up: the rule is second, and the page says so", async () => {
    await menuItem(page, "Trains", "Move up");
    await expect(page.getByRole("status").filter({ hasText: "Trains is now rule 2" })).toBeAttached();
    await expect(rows(page).nth(1)).toContainText("Trains");
    await page.reload();
    await expect(rows(page).nth(1)).toContainText("Trains");
  });

  await test.step("Apply shows what changes first, then changes it", async () => {
    await expect(row(page, "Newsstand")).toContainText("0 transactions");
    await menuItem(page, "Newsstand", "Apply to existing transactions…");
    const dialog = page.getByRole("dialog", { name: "Apply “Newsstand”" });
    await expect(dialog.getByTestId("rule-apply")).toContainText(
      "1 transaction moves to Expenses › Newsstand.",
    );
    await dialog.getByRole("button", { name: "Apply" }).focus();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(row(page, "Newsstand")).toContainText("1 transaction");
  });

  await test.step("Undo puts the movement back", async () => {
    const undo = page.getByRole("button", { name: "Undo" });
    await focusOn(undo);
    await page.keyboard.press("Enter");
    await expect(row(page, "Newsstand")).toContainText("0 transactions");
  });

  await test.step("the movement given by a rule carries the mark and the rule's name", async () => {
    await menuItem(page, "Newsstand", "Apply to existing transactions…");
    const dialog = page.getByRole("dialog", { name: "Apply “Newsstand”" });
    await expect(dialog.getByRole("button", { name: "Apply" })).toBeEnabled();
    await dialog.getByRole("button", { name: "Apply" }).focus();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(row(page, "Newsstand")).toContainText("1 transaction");
    await page.goto("/expenses?preset=last3Months&q=Edicola");
    const mark = page.getByTestId("auto-mark").locator("visible=true").first();
    await focusOn(mark);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toContainText("Rule “Newsstand”");
    await expect(page.getByRole("link", { name: "Open rule" })).toBeVisible();
  });
});
