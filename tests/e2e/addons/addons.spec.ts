// tests/e2e/addons/addons.spec.ts — Settings › Addons (R5a, PA10-PA16) and the screens of R5e that
// follow it: each addon off and on again, «To do» of Overview, and Settings › Alerts.
import { expect, type Page, test } from "@playwright/test";
import { sessionState } from "../_shared/env";
import { hydrated } from "../_shared/helpers";

// Its own copy of the `layout` user (scripts/seed-e2e.ts): turning an addon off changes every page.
test.use({ storageState: sessionState("addons") });
test.describe.configure({ mode: "serial" });

/** Every addon, the page of its menu item, and the block of Overview it has, when it has one. */
const ADDONS = [
  { id: "investments", name: "Investments", href: "/investments" },
  { id: "payroll", name: "Payroll", href: "/payroll" },
  { id: "timeoff", name: "Time off", href: "/timeoff" },
  { id: "budgets", name: "Budgets", href: "/budgets", overview: "budgets" },
  { id: "subscriptions", name: "Subscriptions", href: "/subscriptions" },
  { id: "pockets", name: "Pockets", href: "/pockets", overview: "pockets" },
  { id: "interests", name: "Interests", href: "/interests" },
] as const;

/** What Overview says of the money: the net worth and its three buckets. None of it may change. */
async function figures(page: Page): Promise<string[]> {
  await page.goto("/");
  const hero = page.locator("main p.text-hero");
  await expect(hero).toBeVisible();
  const values = [await hero.innerText()];
  for (const label of ["Cash", "Savings", "Investments"]) {
    const tile = page
      .locator("main span", { hasText: new RegExp(`^${label}$`) })
      .first()
      .locator("..");
    values.push(await tile.innerText());
  }
  return values;
}

async function overviewBlock(page: Page, block: "budgets" | "pockets") {
  return block === "budgets"
    ? page.getByTestId("budgets-card")
    : page.locator("main").getByText("Pockets", { exact: true });
}

async function setAddon(page: Page, name: string, active: boolean) {
  const control = page.getByRole("switch", { name, exact: true });
  await hydrated(control);
  await expect(control).toHaveAttribute("aria-checked", String(!active));
  await control.click();
  if (!active) {
    const dialog = page.getByRole("dialog", { name: `Turn off ${name}?` });
    await expect(dialog.getByTestId("addon-stops")).toContainText("Your data stays");
    await dialog.getByRole("button", { name: "Turn off" }).click();
  }
  await expect(control).toHaveAttribute("aria-checked", String(active));
}

test("each addon off and on again: menu, pages and Overview follow, and no figure changes", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const before = await figures(page);

  for (const addon of ADDONS) {
    await page.goto("/settings/addons");
    // The menu follows with no reload of the page: a mark on the window survives only without one.
    await page.evaluate(() => Object.assign(window, { e2eSamePage: true }));
    const menuItem = page
      .getByRole("navigation", { name: "Primary" })
      .first()
      .locator(`a[href="${addon.href}"]`);
    await expect(menuItem).toHaveCount(1);
    await setAddon(page, addon.name, false);
    await expect(menuItem).toHaveCount(0);
    expect(await page.evaluate(() => "e2eSamePage" in window)).toBe(true);

    // A direct address leads to Settings › Addons, which says why.
    await page.goto(addon.href);
    await expect(page).toHaveURL(`/settings/addons?off=${addon.id}`);
    await expect(page.getByTestId("addon-off")).toContainText(addon.name);

    if ("overview" in addon) {
      await page.goto("/");
      await expect(page.locator("main p.text-hero")).toBeVisible();
      await expect(await overviewBlock(page, addon.overview)).toHaveCount(0);
    }
    expect(await figures(page)).toEqual(before);

    await page.goto("/settings/addons");
    await setAddon(page, addon.name, true);
    await expect(menuItem).toHaveCount(1);
    await page.goto(addon.href);
    await expect(page).toHaveURL(addon.href);
    if ("overview" in addon) {
      await page.goto("/");
      await expect(await overviewBlock(page, addon.overview)).toBeVisible();
    }
  }
  expect(await figures(page)).toEqual(before);
});

test("Work turns Payroll and Time off off together, after listing what stops", async ({ page }) => {
  await page.goto("/settings/addons");
  const work = page.getByRole("switch", { name: "Work", exact: true });
  await hydrated(work);
  await work.click();
  const dialog = page.getByRole("dialog", { name: "Turn off Payroll, Time off?" });
  await expect(dialog.getByTestId("addon-stops")).toContainText(
    "The pension funds of Investments no longer get contributions",
  );
  await dialog.getByRole("button", { name: "Turn off" }).click();
  for (const name of ["Payroll", "Time off"])
    await expect(page.getByRole("switch", { name, exact: true })).toHaveAttribute("aria-checked", "false");
  await expect(
    page
      .getByRole("navigation", { name: "Primary" })
      .first()
      .locator(`a[href="/payroll"], a[href="/timeoff"]`),
  ).toHaveCount(0);
  await work.click();
  for (const name of ["Payroll", "Time off"])
    await expect(page.getByRole("switch", { name, exact: true })).toHaveAttribute("aria-checked", "true");
});

test("Alerts: a locked channel cannot change, and an addon that is off greys its events", async ({
  page,
}) => {
  await page.goto("/settings/notifications");
  const inApp = page.getByRole("switch", { name: "Connection in error In the app" });
  await hydrated(inApp);
  await expect(inApp).toHaveAttribute("data-disabled");
  await expect(inApp).toHaveAttribute("aria-checked", "true");

  const device = page.getByRole("switch", { name: "Budget threshold Device" });
  const was = await device.getAttribute("aria-checked");
  await device.click();
  await expect(device).not.toHaveAttribute("aria-checked", String(was));
  await page.reload();
  await expect(device).not.toHaveAttribute("aria-checked", String(was));
  await device.click();
  await expect(device).toHaveAttribute("aria-checked", String(was));

  await page.goto("/settings/addons");
  await setAddon(page, "Budgets", false);
  await page.goto("/settings/notifications");
  await expect(page.getByTestId("event-budget_threshold")).toContainText("Budgets is off");
  await expect(device).toHaveAttribute("data-disabled");
  await page.goto("/settings/addons");
  await setAddon(page, "Budgets", true);
});

test.describe("«To do»", () => {
  // The `review` user of the seed has transactions to categorize; the test only reads.
  test.use({ storageState: sessionState("review") });

  test("«To do» of Overview is GET /todo, item for item, each a link to its page", async ({ page }) => {
    const answer = await page.request.get("/api/v1/todo");
    expect(answer.ok()).toBe(true);
    const { items } = (await answer.json()) as { items: { event: string }[] };
    expect(items.length).toBeGreaterThan(0);
    await page.goto("/");
    const links = page.getByTestId("todo").getByRole("link");
    await expect(links).toHaveCount(items.length);
    await expect(links.first()).toHaveAttribute("href", /^\//);
    await expect(page.getByTestId("todo")).toContainText("to categorize");
    await expect(page.getByTestId("todo")).not.toContainText("€");
  });
});
