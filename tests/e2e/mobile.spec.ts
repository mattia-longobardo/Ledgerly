// tests/e2e/mobile.spec.ts
import { expect, test } from "@playwright/test";
import { sessionState, USERS } from "./env";
import { signInWithPassword } from "./helpers";

test("phones get bottom tabs and a More sheet instead of the sidebar", async ({ page }) => {
  await signInWithPassword(page, USERS.owner.email, USERS.owner.password);
  const tabs = page
    .getByRole("navigation", { name: "Primary" })
    .filter({ has: page.getByRole("button", { name: "More" }) });
  await expect(tabs.getByRole("link", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("Ledgerly", { exact: true })).toBeHidden();
  await tabs.getByRole("button", { name: "More" }).click();
  const sheet = page.getByRole("dialog", { name: "More" });
  await expect(
    sheet.getByRole("group", { name: "System" }).getByRole("link", { name: "Settings" }),
  ).toBeVisible();
  // The sheet sits above the tab bar instead of covering it (the open modal hides the bar from the
  // accessibility tree, so it is found by its markup here).
  const bar = await page
    .locator("nav", { has: page.locator('button[aria-haspopup="dialog"]') })
    .boundingBox();
  await expect
    .poll(async () => {
      const box = await sheet.boundingBox();
      return box && box.y + box.height;
    })
    .toBe(bar!.y);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  // Accounts is one of the bottom tabs, and its page fits a 400 px screen without sideways
  // scrolling (spec §8.2). Checked inside this test rather than its own: the run's password
  // sign-ins are all spoken for (tests/e2e/env.ts).
  await tabs.getByRole("link", { name: "Accounts" }).click();
  await expect(page).toHaveURL("/accounts");
  await expect(page.getByRole("heading", { name: "No accounts yet" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  await tabs.getByRole("button", { name: "More" }).click();
  await page.getByRole("dialog", { name: "More" }).getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
});

/**
 * The F2 journey at 400 px (spec §11). Its own user, from the seed's session, so it costs none of
 * the run's rate-limited sign-ins (tests/e2e/env.ts) and has movements to show.
 */
test.describe("expenses on a phone", () => {
  test.use({ storageState: sessionState("expenses") });

  test("the table is shown as a list and fits the screen", async ({ page }) => {
    await page.goto("/expenses");
    await expect(page.getByRole("heading", { name: "Expenses" }).first()).toBeVisible();

    // §8.2: below 768 px the table becomes a list. The table itself is hidden, so its column
    // headers are gone from the accessibility tree and the movements are list items.
    await expect(page.getByRole("columnheader", { name: "Payee" })).toBeHidden();
    const rows = page.getByRole("listitem").filter({ hasText: "Esselunga" });
    await expect(rows.first()).toBeVisible();
    await expect(rows.first()).toContainText("45,50 €");

    // No sideways scrolling, the same bar §8.2 sets for Accounts.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // Expenses is one of the bottom tabs of the design.
    const tabs = page
      .getByRole("navigation", { name: "Primary" })
      .filter({ has: page.getByRole("button", { name: "More" }) });
    await expect(tabs.getByRole("link", { name: "Expenses" })).toBeVisible();
  });
});
