// tests/e2e/categories/review.spec.ts — the automatic categories and "To review" (rewrite plan N3, second
// part; ux/n3-categories-manual.md): the mark of an automatic category with its reason, the
// suggestion that does not count until it is confirmed, "Apply to N similar?", the groups with
// their one action and its "Undo", the merge of two categories that look the same, and the guided
// review from the default groups.
//
// The `review` user is seeded with the default groups and seven movements with no category, read
// by the cascade (scripts/seed-e2e.ts): one automatic (a brand with one meaning), three with a
// suggestion (a brand that sells everything), two of an invented shop, one alone. A group carries
// the text of its most recent movement. `reviewNew` has
// movements and no category. The steps follow one another: each starts from what the last left.
import { expect, type Page, test } from "@playwright/test";
import { sessionState } from "../_shared/env";

const EXPENSES = "/expenses?preset=last3Months";
const REVIEW = "/expenses/review";
const rowOf = (page: Page, payee: string) => page.getByRole("row").filter({ hasText: payee });
const group = (page: Page, text: string) =>
  page.getByTestId("review-group").filter({ has: page.getByRole("heading", { name: text, level: 3 }) });

// The journeys of the `review` user change the same movements, and each counts what the one before
// left: in order, on one worker.
test.describe.configure({ mode: "serial" });

test.describe("the automatic categories", () => {
  test.use({ storageState: sessionState("reviewJourney") });

  test("an automatic category says why, a suggestion waits, and a choice asks about the similar ones", async ({
    page,
  }) => {
    await test.step("Expenses says how many movements wait, and how many of them have a suggestion", async () => {
      await page.goto(EXPENSES);
      const notice = page.getByText(/6 transactions to categorise in this range/);
      await expect(notice).toBeVisible();
      await expect(notice).toContainText("3 have a suggestion.");
      await expect(page.getByRole("link", { name: "Review", exact: true })).toHaveAttribute(
        "href",
        /\/expenses\/review\?from=.*&to=/,
      );
    });

    await test.step("the automatic category has a mark that opens its reason, with no number in it", async () => {
      const row = rowOf(page, "TRENITALIA SPA 1021");
      await expect(row.getByRole("button", { name: "Edit category" })).toHaveText("Long distance");
      await row.getByTestId("auto-mark").click();
      const popup = page.getByRole("dialog", { name: "Automatic category" });
      await expect(popup).toContainText("“Trenitalia” is a known brand in this category.");
      await expect(popup).not.toContainText(/%|confidence|model|threshold/i);
      await popup.getByRole("button", { name: "Confirm" }).click();
      await expect(page.getByText("Category confirmed")).toBeVisible();
      await expect(rowOf(page, "TRENITALIA SPA 1021").getByTestId("auto-mark")).toHaveCount(0);
    });

    await test.step("a suggestion is a dashed chip that starts with the word, and counts in no category", async () => {
      const chip = rowOf(page, "AMZN Mktp IT 11").getByTestId("suggestion-chip");
      await expect(chip).toHaveText("Suggestion: Shopping");
      // The card "By category" has no row for it: its money is still "To categorise".
      await expect(
        page.getByRole("heading", { name: "By category" }).locator("..").locator(".."),
      ).not.toContainText("Shopping");
      await chip.click();
      const popup = page.getByRole("dialog", { name: "Suggestion" });
      await expect(popup).toContainText("It does not count in this category until you confirm.");
      await page.keyboard.press("Escape");
      await expect(popup).toHaveCount(0);
    });

    await test.step("choosing a category for one movement asks about the similar ones, and Undo puts them back", async () => {
      const row = rowOf(page, "AMZN Mktp IT 11");
      await row.getByTestId("suggestion-chip").click();
      await page
        .getByRole("dialog", { name: "Suggestion" })
        .getByRole("button", { name: "Choose another" })
        .click();
      await page.getByRole("option", { name: "Housing", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Apply to 2 similar transactions?" });
      await expect(dialog).toContainText("You put “AMZN Mktp IT 11” in Housing.");
      await expect(dialog).toContainText("Suggestion: Shopping");
      await dialog.getByRole("button", { name: "Apply to 2" }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByText("2 transactions updated")).toBeVisible();
      // The table and the phone's list are both in the page: the table is the one counted.
      const chips = page.getByRole("table").getByTestId("suggestion-chip");
      await expect(chips).toHaveCount(0);
      await page.getByRole("button", { name: "Undo" }).click();
      await expect(chips).toHaveCount(2);
      await expect(rowOf(page, "AMZN Mktp IT 11").getByRole("button", { name: "Edit category" })).toHaveText(
        "Housing",
      );
    });
  });

  test("To review: a group is confirmed with one action and undone, another is given a category", async ({
    page,
  }) => {
    await page.goto(REVIEW);
    await expect(page.getByRole("heading", { name: "To review", level: 1 })).toBeVisible();

    await test.step("the groups are in sections, the group with a suggestion first", async () => {
      await expect(page.getByRole("heading", { name: "With a suggestion", level: 2 })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Without a suggestion", level: 2 })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Single transactions", level: 2 })).toBeVisible();
      await expect(group(page, "AMZN Mktp IT 33")).toContainText("2 transactions");
      await expect(group(page, "Bottega Verdi 2")).toContainText("2 transactions · −17,50 €");
    });

    await test.step("Confirm leaves a line in the group's place, and Undo brings the group back", async () => {
      await group(page, "AMZN Mktp IT 33").getByTestId("review-group-confirm").click();
      const done = page.getByTestId("review-done-row");
      await expect(done).toContainText("AMZN Mktp IT 33 · 2 transactions in “Shopping”");
      await expect(group(page, "AMZN Mktp IT 33")).toHaveCount(0);
      await done.getByRole("button", { name: "Undo" }).click();
      await expect(page.getByTestId("review-done-row")).toHaveCount(0);
      await expect(group(page, "AMZN Mktp IT 33")).toHaveCount(1);
    });

    await test.step("a group with no suggestion takes the category chosen for all of it", async () => {
      await group(page, "Bottega Verdi 2")
        .getByRole("button", { name: /Choose a category for 2 transactions/ })
        .click();
      await page.getByRole("option", { name: "Groceries", exact: true }).click();
      await expect(page.getByTestId("review-done-row")).toContainText(
        "Bottega Verdi 2 · 2 transactions in “Groceries”",
      );
    });

    await test.step("the period is the control of Expenses: a stepper, a day picker and the presets", async () => {
      await page.goto(`${REVIEW}?preset=thisMonth`);
      await expect(page.getByTestId("period-text")).toBeVisible();
      await expect(page.getByRole("link", { name: "Previous period" })).toBeVisible();
      await page.getByRole("link", { name: "Previous period" }).click();
      await expect(page).toHaveURL(/off=1/);
      await page.getByRole("link", { name: "All", exact: true }).click();
      await expect(page).toHaveURL(/preset=all/);
      await expect(page.getByRole("heading", { name: "Single transactions", level: 2 })).toBeVisible();
    });

    await test.step("a period with nothing in it says so, with a way back to everything", async () => {
      await page.goto(`${REVIEW}?from=2020-01-01&to=2020-01-31`);
      await expect(page.getByText("Nothing to review in this period")).toBeVisible();
      await page.getByRole("link", { name: "Clear filters" }).click();
      await expect(page).toHaveURL(/\/expenses\/review$/);
    });
  });

  test("two categories that look the same are merged, with every effect said first", async ({ page }) => {
    await page.goto("/settings/finance");
    const proposal = page.getByTestId("merge-proposal");
    await expect(proposal).toHaveCount(1);
    await expect(proposal).toContainText("Cafe");
    await expect(proposal).toContainText("Bar, cafe");
    await proposal.getByRole("button", { name: "Merge…" }).click();
    const dialog = page.getByRole("dialog", { name: "Merge categories" });
    await expect(dialog.getByRole("group", { name: "Which name stays?" })).toBeVisible();
    await expect(dialog).toContainText("is archived.");
    await dialog.getByRole("button", { name: "Merge", exact: true }).click();
    await expect(page.getByText(/Categories merged/)).toBeVisible();
    await expect(page.getByTestId("merge-proposal")).toHaveCount(0);
  });

  test("the palette leads to To review", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("ControlOrMeta+k");
    await page.keyboard.type("To review");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/expenses\/review$/);
  });
});

test.describe("the guided review of a person with no category", () => {
  test.use({ storageState: sessionState("reviewNewJourney") });

  test("starts from the default groups, then the categories, and can be finished later", async ({ page }) => {
    await page.goto(`${REVIEW}?guide=1&bank=Zeta%20Bank`);
    await expect(page.getByRole("group", { name: "Choose the groups for your spending" })).toBeVisible();
    // The 11 groups of Wallet's tree, each with its sub-categories under it (decisions 1A–3A).
    await expect(page.getByRole("checkbox")).toHaveCount(11);
    await expect(page.getByRole("checkbox", { name: "Food & Drinks" })).toHaveAccessibleDescription(
      "Bar, cafe · Restaurant, fast-food · Groceries",
    );
    // A group can be left out: the button counts the groups it creates.
    await page.getByRole("checkbox", { name: "Others" }).click();
    await expect(page.getByRole("button", { name: "Create 10 groups" })).toBeVisible();
    await page.getByRole("checkbox", { name: "Others" }).click();
    await page.getByRole("button", { name: "Create 11 groups" }).click();

    // The cascade reads the movements again with the groups: the brand it knows gets its category.
    await expect(page.getByText("First reading of Zeta Bank")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/groups done/)).toBeVisible();
    await page.getByRole("link", { name: "Finish later" }).click();
    await expect(page.getByRole("heading", { name: "Review finished" })).toBeVisible();
    await expect(page.getByText(/from Zeta Bank/)).toBeVisible();
    await page.getByRole("link", { name: "Go to Expenses" }).click();
    await expect(page).toHaveURL(/\/expenses$/);
  });
});

for (const { width, height } of [
  { width: 1440, height: 900 },
  { width: 400, height: 860 },
]) {
  test.describe(`To review at ${width} px`, () => {
    test.use({ storageState: sessionState("reviewJourney") });
    test("has no sideways scroll, with a group open", async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto(REVIEW);
      await expect(page.getByTestId("review-group").first()).toBeVisible();
      await page
        .getByRole("button", { name: /Show all/ })
        .first()
        .click()
        .catch(() => undefined);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    });
  });
}
