// tests/e2e/investments/keyboard.spec.ts — the keyboard checks of the flow `investments`; what the
// keyboard checks of every flow share is in tests/e2e/_shared/keyboard.ts.
import { expect, test } from "@playwright/test";
import { dialogHasFocus, focusIsVisible, focusOn } from "../_shared/keyboard";
import { sessionState } from "../_shared/env";

test.use({ storageState: sessionState("layout") });

test("a service's tabs are walked from the keyboard, each one a page, the period kept", async ({ page }) => {
  await page.goto("/investments?preset=all");
  const service = page.getByRole("link", { name: "eToro", exact: true }).filter({ visible: true }).first();
  await page.goto((await service.getAttribute("href"))!);

  const tabs = page.getByRole("navigation", { name: "Sections of the service" });
  const names = ["Overview", "Positions", "Activity", "Connection"];
  await focusOn(tabs.getByRole("link", { name: "Overview" }));
  expect(await focusIsVisible(page), "the tab draws no ring").toBe(true);
  for (const name of names.slice(1)) {
    await page.keyboard.press("Tab");
    await expect(tabs.getByRole("link", { name: new RegExp(`^${name}`) })).toBeFocused();
    expect(await focusIsVisible(page), `the ${name} tab draws no ring`).toBe(true);
  }
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/connection\?preset=all$/);
  await expect(tabs.getByRole("link", { name: /^Connection/ })).toHaveAttribute("aria-current", "page");
});

test("Positions: the open, closed and all-closed views are links walked from the keyboard (§3.4)", async ({
  page,
}) => {
  await page.goto("/investments?preset=all");
  const service = page.getByRole("link", { name: "eToro", exact: true }).filter({ visible: true }).first();
  await page.goto(`${(await service.getAttribute("href"))!.replace(/\?.*$/, "")}/positions?preset=all`);

  const status = page.getByRole("group", { name: "Which positions" });
  await focusOn(status.getByRole("link", { name: /^Open/ }));
  expect(await focusIsVisible(page), "the Open link draws no ring").toBe(true);
  await page.keyboard.press("Tab");
  await expect(status.getByRole("link", { name: /^Closed in/ })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(status.getByRole("link", { name: /^All closed/ })).toBeFocused();
  expect(await focusIsVisible(page), "the All closed link draws no ring").toBe(true);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/positions\?preset=all&status=all$/);
  await expect(status.getByRole("link", { name: /^All closed/ })).toHaveAttribute("aria-current", "true");
  // A row's asset opens its Activity: a link of its own, apart from the row.
  const asset = page.getByTestId("closed-row").first().getByRole("link").first();
  await focusOn(asset);
  expect(await focusIsVisible(page), "the asset link draws no ring").toBe(true);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/activity\?preset=all&asset=/);
});

test.describe("a manual portfolio (R5d)", () => {
  test.use({ storageState: sessionState("portfolio") });

  test("«Record operation» opens from the keyboard, its search answers, and Escape gives the focus back", async ({
    page,
  }) => {
    await page.goto("/investments");
    const service = page.getByRole("link", { name: "Broker", exact: true }).filter({ visible: true }).first();
    await page.goto((await service.getAttribute("href"))!);
    const record = page.getByRole("button", { name: "Record operation" });
    await focusOn(record);
    expect(await focusIsVisible(page), "the button draws no ring").toBe(true);
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Record operation · Broker" });
    await expect(dialog).toBeVisible();
    await dialogHasFocus(page);
    const search = dialog.getByRole("searchbox", { name: "Instrument" });
    await focusOn(search);
    await page.keyboard.type("IE00BK5BQT80");
    const hit = dialog.getByRole("radio").first();
    await expect(hit).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(hit).toBeFocused();
    expect(await focusIsVisible(page), "the instrument draws no ring").toBe(true);
    await page.keyboard.press("Space");
    await expect(hit).toBeChecked();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(record).toBeFocused();
  });
});

test.describe("the purchase plans (PERS-681)", () => {
  test.use({ storageState: sessionState("plans") });

  test("an execution's «Review» opens from the keyboard, and Escape gives the focus back", async ({
    page,
  }) => {
    await page.goto("/investments");
    const service = page
      .getByRole("link", { name: "Senza liquidità", exact: true })
      .filter({ visible: true })
      .first();
    await page.goto(`${await service.getAttribute("href")}/plans`);
    const confirm = page
      .getByRole("button", { name: /^Review the proposal of/ })
      .filter({ visible: true })
      .first();
    await focusOn(confirm);
    expect(await focusIsVisible(page), "the button draws no ring").toBe(true);
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: /^Review the proposal of/ });
    await expect(dialog).toBeVisible();
    await dialogHasFocus(page);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(confirm).toBeFocused();
  });

  test("«New plan» opens from the keyboard, and Escape gives the focus back", async ({ page }) => {
    await page.goto("/investments");
    const service = page.getByRole("link", { name: "Piani", exact: true }).filter({ visible: true }).first();
    await page.goto(`${await service.getAttribute("href")}/plans`);
    const opener = page.getByRole("button", { name: "New plan" });
    await focusOn(opener);
    expect(await focusIsVisible(page), "the button draws no ring").toBe(true);
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "New purchase plan · Piani" });
    await expect(dialog).toBeVisible();
    await dialogHasFocus(page);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });
});
