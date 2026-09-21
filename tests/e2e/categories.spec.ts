// tests/e2e/categories.spec.ts — Settings › Categories (F8.1, owner 2026-09-21): the tree, the
// colour a group lends its sub-categories, and the deletion that says what it takes before it
// takes it. Its own user, with no Wallet connection, so nothing here can reach an external
// account: the dialog still says Wallet is included, which is the sentence worth checking.
import { expect, test } from "@playwright/test";
import { sessionState } from "./env";

test.use({ storageState: sessionState("tokens") });

test("a person builds a group, hangs a sub-category on it and deletes both", async ({ page }) => {
  const group = `E2E ${Date.now()}`;
  // Names nothing else on the page shares: "Sub" alone also matches the Subscriptions nav item.
  const child = `${group} sub`;

  await test.step("a new group gets a colour without being asked for one", async () => {
    await page.goto("/settings/categories");
    await expect(page.getByRole("heading", { name: "Categories", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "New group" }).click();
    const dialog = page.getByRole("dialog", { name: "New group" });
    await dialog.getByLabel("Name").fill(group);
    // The colour field is there and nothing has been picked: "Automatic" is the state it opens in.
    await expect(dialog.getByRole("button", { name: "Automatic" })).toHaveAttribute("aria-pressed", "true");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page.locator("main").getByText(group, { exact: true })).toBeVisible();
  });

  await test.step("a sub-category is added from its own group's row", async () => {
    const section = page.getByRole("listitem").filter({ hasText: group }).first();
    await section.getByRole("button", { name: "Add sub-category" }).click();
    const dialog = page.getByRole("dialog", { name: "Add sub-category" });
    await dialog.getByLabel("Name").fill(child);
    // A sub-category has no colour of its own: the dialog says whose it wears.
    await expect(dialog.getByText(`It is drawn in ${group}'s colour.`)).toBeVisible();
    await expect(dialog.getByLabel("Colour")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page.locator("main").getByText(child, { exact: true })).toBeVisible();
  });

  await test.step("the child is drawn in the group's colour, not one of its own", async () => {
    const dots = page
      .getByRole("listitem")
      .filter({ hasText: group })
      .first()
      .locator("span[style*='background-color']");
    const colours = await dots.evaluateAll((nodes) =>
      nodes.map((node) => getComputedStyle(node).backgroundColor),
    );
    expect(colours.length).toBeGreaterThanOrEqual(2);
    expect(new Set(colours).size).toBe(1);
  });

  await test.step("deleting says what it takes, Wallet included, and only then takes it", async () => {
    const section = page.getByRole("listitem").filter({ hasText: group }).first();
    // `exact`: the sub-category's own menu is named "<group> sub" and would match too.
    await section.getByRole("button", { name: group, exact: true }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete this category?" });
    await expect(dialog).toContainText("cannot be undone");
    await expect(dialog).toContainText("Its sub-categories are deleted with it.");
    await expect(dialog).toContainText("It is deleted in Wallet too, if it came from there.");
    await dialog.getByRole("button", { name: "Delete" }).click();
    await expect(page.locator("main").getByText(group, { exact: true })).toHaveCount(0);
    await expect(page.locator("main").getByText(child, { exact: true })).toHaveCount(0);
  });
});
