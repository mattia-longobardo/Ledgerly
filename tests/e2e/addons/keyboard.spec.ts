// tests/e2e/addons/keyboard.spec.ts — the keyboard checks of the flow `addons`; what the keyboard
// checks of every flow share is in tests/e2e/_shared/keyboard.ts.
import { expect, test } from "@playwright/test";
import { dialogHasFocus, focusIsVisible, focusOn } from "../_shared/keyboard";
import { sessionState } from "../_shared/env";
import { hydrated } from "../_shared/helpers";

test.use({ storageState: sessionState("layout") });

test("an addon's switch asks from the keyboard, and Escape keeps it on", async ({ page }) => {
  await page.goto("/settings/addons");
  const budgets = page.getByRole("switch", { name: "Budgets", exact: true });
  await focusOn(budgets);
  expect(await focusIsVisible(page)).toBe(true);
  await page.keyboard.press("Space");
  await dialogHasFocus(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(budgets).toHaveAttribute("aria-checked", "true");
});

test("the channels of Alerts are reached with Tab, with a visible ring", async ({ page }) => {
  await page.goto("/settings/notifications");
  const email = page.getByRole("switch", { name: "Connection in error Email" });
  await focusOn(email);
  expect(await focusIsVisible(page)).toBe(true);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("switch", { name: "Connection in error Device" })).toBeFocused();
});

test.describe("«To do»", () => {
  // The `review` user of the seed has transactions to categorize.
  test.use({ storageState: sessionState("review") });

  test("«To do» of Overview is a list of links the keyboard follows", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("todo")).toBeVisible();
    const first = page.getByTestId("todo").getByRole("link").first();
    await focusOn(first);
    expect(await focusIsVisible(page)).toBe(true);
    const href = await first.getAttribute("href");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(href ?? "/");
  });
});

test.describe("the first start", () => {
  // `welcome` keeps the first start ahead of it: the check never ends it.
  test.use({ storageState: sessionState("welcome") });

  test("its fields and its addons are reached with Tab, and each step puts the focus on its title", async ({
    page,
  }) => {
    await page.route("**/api/v1/onboarding", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ json: { pending: false, country: null, proposal: null } })
        : route.fallback(),
    );
    await page.goto("/welcome");
    const country = page.getByLabel("Country", { exact: true });
    await hydrated(country);
    await focusOn(country);
    expect(await focusIsVisible(page)).toBe(true);
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Display currency")).toBeFocused();
    await focusOn(page.getByRole("button", { name: "Continue" }));
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 1, name: "Addons" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("checkbox", { name: "Investments" })).toBeFocused();
    await page.keyboard.press("Space");
    await expect(page.getByRole("checkbox", { name: "Investments" })).toBeChecked();
    await focusOn(page.getByRole("button", { name: "Continue" }));
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 1, name: "Your first account" })).toBeFocused();
  });
});
