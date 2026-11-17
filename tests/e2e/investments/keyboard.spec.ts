// tests/e2e/investments/keyboard.spec.ts — the keyboard checks of the flow `investments`; what the
// keyboard checks of every flow share is in tests/e2e/_shared/keyboard.ts.
import { expect, test } from "@playwright/test";
import { focusIsVisible, focusOn } from "../_shared/keyboard";
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
