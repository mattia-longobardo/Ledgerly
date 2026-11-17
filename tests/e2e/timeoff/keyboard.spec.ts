// tests/e2e/timeoff/keyboard.spec.ts — the keyboard checks of the flow `timeoff`; what the
// keyboard checks of every flow share is in tests/e2e/_shared/keyboard.ts.
import { expect, test } from "@playwright/test";
import { focused, focusIsVisible, focusOn, tabUntil } from "../_shared/keyboard";
import { sessionState } from "../_shared/env";
import { THIS_YEAR } from "../_shared/helpers";

test.use({ storageState: sessionState("layout") });

test("Time off: a range is picked, confirmed, removed and undone without a mouse (rewrite plan N5)", async ({
  page,
}) => {
  const year = THIS_YEAR;
  await page.goto("/timeoff");
  const focusedDate = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.date);
  const bar = page.getByTestId("selection-bar");
  // One Remove button per booked row: counting them is counting the rows, whatever the seed holds.
  const removes = page.getByRole("table").getByRole("button", { name: "Remove" });
  await expect(removes.first()).toBeVisible();
  const seeded = await removes.count();
  expect(seeded).toBeGreaterThan(0);

  // Into March from one of its days, then to the month's last day that can be booked.
  await focusOn(page.locator(`[data-month="3"] button[data-date]`).first());
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

  await test.step("two booked days go together, from the panel of the first one, and Undo brings both", async () => {
    await focusOn(page.locator(`[data-date="${first}"]`));
    await page.keyboard.press("Enter");
    const edit = page.getByRole("dialog", { name: "Edit leave" });
    await expect(edit).toBeVisible();
    await tabUntil(page, 12, async () => (await focused(page)) === 'button "Select more days from here"');
    expect(await focused(page)).toBe('button "Select more days from here"');
    await page.keyboard.press("Enter");
    await expect(edit).toHaveCount(0);
    await expect(bar).toBeVisible();
    await expect.poll(focusedDate).toBe(first);

    await page.keyboard.press("ArrowRight");
    await expect.poll(focusedDate).toBe(last);
    await page.keyboard.press("Enter");
    const panel = page.getByRole("dialog", { name: "New leave" });
    await expect(panel).toBeVisible();
    await tabUntil(page, 20, async () => (await focused(page)) === 'button "Remove 2 days"');
    expect(await focused(page)).toBe('button "Remove 2 days"');
    await page.keyboard.press("Enter");
    const list = page.getByRole("dialog", { name: "Remove leave" });
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await list.getByRole("button", { name: "Remove 2 days" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("2 days removed", { exact: true })).toBeVisible();
    await expect(removes).toHaveCount(seeded);

    await page.keyboard.press("F6");
    await tabUntil(page, 4, async () => (await focused(page)) === 'button "Undo"');
    await page.keyboard.press("Enter");
    await expect(page.getByText("Undone")).toBeVisible();
    await expect(removes).toHaveCount(seeded + 2);
  });

  await test.step("a booked day becomes half vacation and half ROL from the keyboard, in one step", async () => {
    await focusOn(page.locator(`[data-date="${first}"]`));
    await page.keyboard.press("Enter");
    const edit = page.getByRole("dialog", { name: "Edit leave" });
    await expect(edit).toBeVisible();
    await tabUntil(page, 12, async () => (await focused(page)) === 'button "Whole day"');
    expect(await focused(page)).toBe('button "Whole day"');
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    expect(await focused(page)).toBe('button "Half + half"');
    expect(await focusIsVisible(page)).toBe(true);
    await page.keyboard.press("Enter");
    await expect(edit.getByLabel("Other half")).toHaveValue("rol");
    await tabUntil(page, 20, async () => (await focused(page)) === 'button "Confirm"');
    expect(await focused(page)).toBe('button "Confirm"');
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Edit leave" })).toHaveCount(0);
    await expect(page.locator(`[data-date="${first}"]`)).toHaveAttribute("aria-label", /Vacation, ROL/);
    await expect(removes).toHaveCount(seeded + 3);
  });

  await test.step("the two days go again, so the next spec finds the year as the seed left it", async () => {
    for (const [index, date] of [first, last].entries()) {
      await focusOn(page.locator(`[data-date="${date}"]`));
      await page.keyboard.press("Delete");
      await expect(removes).toHaveCount(seeded + 1 - index);
    }
  });
});
