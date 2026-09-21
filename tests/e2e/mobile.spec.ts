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

/** The Budgets journey at 400 px (spec §8.2, §11): the table becomes a list and fits the screen. */
test.describe("budgets on a phone", () => {
  test.use({ storageState: sessionState("budgets") });

  test("the budgets are a list reachable from the More sheet", async ({ page }) => {
    await page.goto("/");
    const tabs = page
      .getByRole("navigation", { name: "Primary" })
      .filter({ has: page.getByRole("button", { name: "More" }) });
    await tabs.getByRole("button", { name: "More" }).click();
    await page.getByRole("dialog", { name: "More" }).getByRole("link", { name: "Budgets" }).click();
    await expect(page).toHaveURL("/budgets");

    await expect(page.getByRole("columnheader", { name: "Budget" })).toBeHidden();
    await expect(page.getByTestId("budget-item").filter({ hasText: "Spesa" })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

/** The Pockets page at 400 px (spec §8.2, §11): list above the detail, nothing sideways. */
test.describe("pockets on a phone", () => {
  test.use({ storageState: sessionState("pockets") });

  test("the list sits above the pocket and the page fits the screen", async ({ page }) => {
    await page.goto("/pockets");
    const card = page.getByTestId("pocket-card").first();
    const detail = page.getByTestId("pocket-detail");
    await expect(detail).toBeVisible();
    expect((await card.boundingBox())!.y).toBeLessThan((await detail.boundingBox())!.y);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

/** The Subscriptions page at 400 px (spec §8.2, §11): the table becomes a list. */
test.describe("subscriptions on a phone", () => {
  test.use({ storageState: sessionState("subscriptions") });

  test("the subscriptions are a list and the page fits the screen", async ({ page }) => {
    await page.goto("/subscriptions");
    // The top bar keeps the primary action inside the screen; the suggestions move into the page.
    const add = page.getByRole("button", { name: "Add subscription" });
    await expect(add).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole("button", { name: /Suggest from recurring payments/ })).toBeInViewport();
    await expect(page.getByRole("columnheader", { name: "Billing" })).toBeHidden();
    await expect(page.getByTestId("subscription-item").filter({ hasText: "Netflix" })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

/** Interests at 400 px (spec §8.2, §11): the rules are a list and the page fits. */
test.describe("interests on a phone", () => {
  test.use({ storageState: sessionState("interests") });

  test("the page fits the screen", async ({ page }) => {
    await page.goto("/interests");
    await expect(page.getByRole("heading", { name: "Interests" }).first()).toBeAttached();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

/** Funds at 400 px (spec §8.2, §11): the page fits the screen. */
test.describe("funds on a phone", () => {
  test.use({ storageState: sessionState("funds") });

  test("the page fits the screen", async ({ page }) => {
    await page.goto("/funds");
    await expect(page.getByRole("heading", { name: "Funds" }).first()).toBeAttached();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

/**
 * Time off at 400 px (plan F7 L2, §11). The screen is a chart, twelve calendars and a table, and
 * the table has six columns — the width worth checking is this one, not the desktop's.
 */
test.describe("time off on a phone", () => {
  test.use({ storageState: sessionState("timeoff") });

  test("shows the cards, the calendar and the table without scrolling sideways", async ({ page }) => {
    await page.goto("/timeoff");
    await expect(page.getByRole("heading", { name: "Work & Time off", level: 1 })).toBeVisible();

    // Time off is a bottom tab, in the Work group.
    const tabs = page
      .getByRole("navigation", { name: "Primary" })
      .filter({ has: page.getByRole("button", { name: "More" }) });
    await expect(tabs.getByRole("link", { name: "Time off" })).toBeVisible();

    // Both cards in the same unit since N5 — days, ROL included — and the provenance of each.
    await expect(page.getByTestId("vacation-card")).toContainText("days remaining");
    await expect(page.getByTestId("rol-card")).toContainText("days remaining");
    await expect(page.getByTestId("vacation-card")).toContainText("Allowance");
    // And the card that counts the whole year, which a phone has to fit too.
    await expect(page.getByTestId("taken-card")).toContainText("2.5");

    // The twelve calendars are there, and the seeded days are marked.
    await expect(page.getByTestId("leave-cell")).toHaveCount(3);

    // The note and status columns step aside at this width; the status still shows under the date.
    await expect(page.getByRole("columnheader", { name: "Note" })).toBeHidden();
    // A day's own row, not the month heading above it: only a day carries an Edit button.
    const dayRow = page
      .getByRole("row")
      .filter({ has: page.getByRole("button", { name: "Edit" }) })
      .first();
    await expect(dayRow).toContainText(/Taken|Planned/);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
