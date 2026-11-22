// tests/e2e/funds/keyboard.spec.ts — the keyboard checks of the flow `funds`; what the
// keyboard checks of every flow share is in tests/e2e/_shared/keyboard.ts.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { dialogHasFocus, focused, focusIsVisible, focusOn } from "../_shared/keyboard";
import { sessionState } from "../_shared/env";
import { LAST_YEAR } from "../_shared/helpers";
import { FUNDS, fundLink, fundPath } from "./place";

test.use({ storageState: sessionState("layout") });

test.describe("a fund's new page", () => {
  test.use({ storageState: sessionState("fundsDetail") });

  test("the fund, its tabs, its period and its projection are walked from the keyboard", async ({ page }) => {
    await page.goto(FUNDS);
    const name = fundLink(page, "Pensione Beta");
    await focusOn(name);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/investments\/[0-9a-f-]+$/);

    const period = page.getByRole("group", { name: "Date range" });
    const all = period.getByRole("link", { name: "All" });
    await focusOn(all);
    expect(await focusIsVisible(page), "the All link draws no ring").toBe(true);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/preset=all$/);

    const tabs = page.getByRole("navigation", { name: "Fund" });
    const contributions = tabs.getByRole("link", { name: "Contributions" });
    await focusOn(contributions);
    expect(await focusIsVisible(page), "the tab draws no ring").toBe(true);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/tab=contributions/);
    await expect(page).toHaveURL(/preset=all/);

    await focusOn(tabs.getByRole("link", { name: "Overview" }));
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("fund-projection")).toBeVisible();
    const summary = page.getByTestId("fund-projection").locator("summary");
    await focusOn(summary);
    expect(await focusIsVisible(page), "the projection draws no ring").toBe(true);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("fund-projection")).toHaveAttribute("open", "");
  });

  for (const [fund, tab, period] of [
    ["Piano Uno", "Contributions", "contributions"],
    ["Piano Uno", "Values", "valuations"],
    ["Pensione Beta", "Contributions", "contributions"],
    ["Pensione Beta", "Values", "valuations"],
  ] as const) {
    test(`${fund}: ${tab}, its period and its controls are walked from the keyboard`, async ({ page }) => {
      await page.goto(await fundPath(page, fund));

      const link = page.getByRole("navigation", { name: "Fund" }).getByRole("link", { name: tab });
      await focusOn(link);
      expect(await focusIsVisible(page), "the tab draws no ring").toBe(true);
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(new RegExp(`tab=${period}`));

      const all = page.getByRole("group", { name: "Date range" }).getByRole("link", { name: "All" });
      await focusOn(all);
      expect(await focusIsVisible(page), "the All link draws no ring").toBe(true);
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(new RegExp(`tab=${period}.*preset=all|preset=all.*tab=${period}`));
      // The rows of the whole history are the page's once "All" is the period it says it shows.
      await expect(all).toHaveAttribute("aria-current", "true");

      const control = page
        .locator("main")
        .getByRole("button", { name: /^(Edit|Delete)( the contribution of .+)?$/ })
        .first();
      await focusOn(control);
      expect(await focusIsVisible(page), "the row's control draws no ring").toBe(true);
    });
  }
});

// Release N6 (docs/design/rewrite-plan/ux/n6-pension-fund.md §17.1): the four dialogs of a fund and the
// form that creates one, as the seeded `layout` user, whose "Cometa" is fed by the payslip and whose
// "Fideuram Master Selection" has a debit and two fees.
test.describe("a fund's dialogs and the form that creates one", () => {
  /** A tab of one of `layout`'s funds, by the fund's name. */
  async function openFund(page: Page, name: string, query: string): Promise<void> {
    await page.goto(`${await fundPath(page, name, "?preset=all")}${query}`);
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
    await dialogHasFocus(page);
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
    await openFund(page, "Cometa", "?tab=contributions&preset=all");
    const opener = page
      .getByTestId("fund-contributions")
      .getByRole("button", { name: "Record contribution" });
    await focusOn(opener);
    expect(await focusIsVisible(page), "the button that opens the dialog draws no ring").toBe(true);
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: /^Record contribution/ });
    await expect(dialog).toBeVisible();
    // The kind is chosen with the keyboard too: Enter on a segment presses it, and the fields follow.
    const other = dialog.getByRole("button", { name: "Other operation" });
    await focusOn(other);
    expect(await focusIsVisible(page), "the kind draws no ring").toBe(true);
    await page.keyboard.press("Enter");
    await expect(other).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.getByLabel("Operation")).toBeVisible();
    // Space ticks "I do not know the fee", which switches the fee field off.
    const unknown = dialog.getByRole("checkbox", { name: "I do not know the fee" });
    await focusOn(unknown);
    await page.keyboard.press("Space");
    await expect(unknown).toBeChecked();
    await expect(dialog.getByLabel("Fee", { exact: true })).toBeDisabled();
    await trapsAndGivesBack(page, opener, /^Record contribution/);
  });

  test("the value dialog traps the focus, closes on Escape and gives the focus back", async ({ page }) => {
    await openFund(page, "Fideuram Master Selection", "");
    const opener = page.getByRole("banner").getByRole("button", { name: "Update value" });
    await focusOn(opener);
    expect(await focusIsVisible(page), "the button that opens the dialog draws no ring").toBe(true);
    await page.keyboard.press("Enter");
    await trapsAndGivesBack(page, opener, /^Update value/);
  });

  test("the source dialog traps the focus, from Edit and from the Add source menu, and gives it back", async ({
    page,
  }) => {
    await openFund(page, "Cometa", "?tab=settings");
    const edit = page.getByRole("button", { name: "Edit Payslip" });
    await focusOn(edit);
    expect(await focusIsVisible(page), "Edit draws no ring").toBe(true);
    await page.keyboard.press("Enter");
    // The switch of the due date is a stop of the dialog, with its ring, and Space turns it.
    const due = page.getByRole("dialog").getByRole("switch", { name: "The transfer has a due date" });
    await focusOn(due);
    expect(await focusIsVisible(page), "the switch draws no ring").toBe(true);
    const was = await due.getAttribute("aria-checked");
    await page.keyboard.press("Space");
    await expect(due).not.toHaveAttribute("aria-checked", was!);
    await expect(due).toBeFocused();
    await trapsAndGivesBack(page, edit, /^Payslip$/);

    // From the menu: the arrows walk it, Enter opens the dialog, and Escape gives the focus to the
    // button the menu hangs from.
    const add = page.getByTestId("fund-sources").getByRole("button", { name: "Add source" });
    await focusOn(add);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu", { name: "Add source" })).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitem", { name: "Recurring debit" })).toBeFocused();
    await page.keyboard.press("Enter");
    await trapsAndGivesBack(page, add, /^Recurring debit$/);

    // A source's own menu closes on Escape and gives the focus back.
    const actions = page.getByRole("button", { name: "Actions for Payslip" });
    await focusOn(actions);
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
    await focusOn(add);
    expect(await focusIsVisible(page), "Add fee draws no ring").toBe(true);
    await page.keyboard.press("Enter");
    await trapsAndGivesBack(page, add, /^Add fee$/);

    const edit = page
      .getByTestId("fund-fees")
      .getByRole("button", { name: "Edit Management" })
      .filter({ visible: true });
    await focusOn(edit);
    expect(await focusIsVisible(page), "a fee's Edit draws no ring").toBe(true);
    await page.keyboard.press("Enter");
    await trapsAndGivesBack(page, edit, /^Edit fee$/);
  });

  test("the form: every stop draws a ring, a step gives the focus to its heading, Escape does nothing", async ({
    page,
  }) => {
    await page.goto("/investments/new-fund");
    const form = page.getByTestId("fund-wizard");
    const step = (name: string) => page.getByTestId(`wizard-step-${name}`);

    // Step 1: its fields, "Advanced" and the two commands, in the order of the page.
    const name = form.getByLabel("Name");
    await focusOn(name);
    expect(await focusIsVisible(page), "the name draws no ring").toBe(true);
    await page.keyboard.type("Fondo Tastiera");
    const advanced = step("fund").locator("summary");
    await focusOn(advanced);
    expect(await focusIsVisible(page), "Advanced draws no ring").toBe(true);
    await page.keyboard.press("Enter");
    await expect(form.getByLabel("Code")).toBeVisible();
    await focusOn(form.getByLabel("Member since"));
    // The year is typed a digit at a time: a date half written is no date yet, and breaks nothing.
    await page.keyboard.type(`0301${LAST_YEAR}`);
    await expect(step("fund")).toBeVisible();
    await page.keyboard.press("Enter");

    // Step 2: the heading has the focus, the step done is a link with its ring, a switch turns on Space.
    await expect(page).toHaveURL(/step=sources$/);
    await expect(page.getByRole("heading", { name: "How you pay in", level: 2 })).toBeFocused();
    const done = page.getByRole("list", { name: "Steps" }).getByRole("link", { name: /The fund/ });
    await focusOn(done);
    expect(await focusIsVisible(page), "the step done draws no ring").toBe(true);
    const debit = page.getByTestId("source-switch-bank_debit");
    await focusOn(debit);
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
    await focusOn(step("sources").getByLabel("Payee contains"));
    await page.keyboard.type("Esempio");
    await page.keyboard.press("Enter");

    // Step 3: the fee dialog opens and closes from the keyboard, and gives the focus back.
    await expect(page).toHaveURL(/step=fees$/);
    await expect(page.getByRole("heading", { name: "Fees", level: 2 })).toBeFocused();
    const add = step("fees").getByRole("button", { name: "Add fee" });
    await focusOn(add);
    await page.keyboard.press("Enter");
    await trapsAndGivesBack(page, add, /^Add fee$/);
    const skip = step("fees").getByRole("button", { name: "Skip for now" });
    await focusOn(skip);
    expect(await focusIsVisible(page), "the step's command draws no ring").toBe(true);
    await page.keyboard.press("Enter");

    // Step 4: the heading again; "Back" goes a step back and nothing was written.
    await expect(page).toHaveURL(/step=review$/);
    await expect(page.getByRole("heading", { name: "Summary", level: 2 })).toBeFocused();
    const back = step("review").getByRole("button", { name: "Back" });
    await focusOn(back);
    expect(await focusIsVisible(page), "Back draws no ring").toBe(true);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/step=fees$/);
    await expect(page.getByRole("heading", { name: "Fees", level: 2 })).toBeFocused();
  });
});
