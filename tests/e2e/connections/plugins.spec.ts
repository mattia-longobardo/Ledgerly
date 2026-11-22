// tests/e2e/connections/plugins.spec.ts — the bank plugin of each person (rewrite plan N1, decision H25;
// ux/n1-plugin-bank.md §1.1, §2, §6.3): no step of an admin, each person turns it on for
// themselves, and what one person does changes nothing for another.
//
// It needs the plugin of the standard installation. It enters no real credentials and reaches no
// bank: the trial on a real bank is the owner's, in a browser.
import { expect, type Page, test } from "@playwright/test";
import { sessionState } from "../_shared/env";

const ROW = '[data-testid="plugin-row"][data-plugin="enablebanking"]';
const RETURN_PATH = "/api/v1/plugins/enablebanking/callback";
// The plugin's page (rewrite plan N7.2): only while it is on; otherwise its address leads to the list.
const PAGE = "/settings/plugins/enablebanking";

async function integrations(page: Page) {
  await page.goto("/settings/plugins");
  await expect(page.locator(ROW)).toBeVisible();
}

async function pluginPage(page: Page) {
  await page.goto(PAGE);
  await expect(page).toHaveURL(new RegExp(`${PAGE}$`));
}

test.describe("a person who is not an admin", () => {
  test.use({ storageState: sessionState("pockets") });

  test("turns the plugin on, sees its page, and turns it off, alone @site", async ({ page, browser }) => {
    await integrations(page);
    const row = page.locator(ROW);
    const banks = page.getByRole("region", { name: "Connection" });

    await test.step("it is there, not active, and nothing else is new", async () => {
      await expect(row).toHaveAttribute("data-state", "available");
      await expect(row).toContainText("Not active");
      await expect(page.getByTestId("banks-card")).toHaveCount(0);
      await page.goto(PAGE);
      await expect(page).toHaveURL(/\/settings\/plugins#source-enablebanking$/);
      expect((await page.goto("/banks/connect"))?.status()).toBe(404);
    });

    await test.step("turning it on asks nothing and opens its page on its guide", async () => {
      await integrations(page);
      await row.getByRole("button", { name: "Turn on" }).click();
      await expect(page.getByText("Enable Banking turned on")).toBeVisible();
      await expect(page.getByTestId("source-row").filter({ hasText: "Enable Banking" })).toBeVisible();
      await pluginPage(page);
      await expect(page.getByTestId("source-title")).toHaveText("Enable Banking");
      await expect(banks.getByRole("button", { name: "Enter credentials" })).toBeVisible();
      await expect(banks.getByLabel("Return address")).toHaveValue(new RegExp(`${RETURN_PATH}$`));
    });

    await test.step("another person, an admin included, sees no change", async () => {
      const context = await browser.newContext({ storageState: sessionState("admin") });
      const other = await context.newPage();
      await integrations(other);
      await expect(other.locator(ROW)).toHaveAttribute("data-state", "available");
      await expect(other.getByTestId("banks-card")).toHaveCount(0);
      expect((await other.goto("/banks/connect"))?.status()).toBe(404);
      await context.close();
    });

    await test.step("the procedure asks for the credentials first", async () => {
      await page.goto("/banks/connect");
      await expect(page.getByText("First you need your Enable Banking credentials.")).toBeVisible();
    });

    await test.step("a text that is not a key is refused, and the fields come back empty", async () => {
      await pluginPage(page);
      await banks.getByRole("button", { name: "Enter credentials" }).click();
      const dialog = page.getByRole("dialog", { name: "Enable Banking credentials" });
      await dialog.getByLabel("Application ID").fill("not-an-application");
      await dialog.getByLabel("Private key").fill("this is not a private key");
      await dialog.getByRole("button", { name: "Verify and save" }).click();
      await expect(dialog.getByRole("alert")).toContainText("does not look like the private key file");
      await expect(dialog.getByLabel("Application ID")).toHaveValue("");
      await expect(dialog.getByLabel("Private key")).toHaveValue("");
      await page.keyboard.press("Escape");
      await expect(banks.getByRole("button", { name: "Enter credentials" })).toBeVisible();
    });

    await test.step("a return nobody started is refused, and its address carries nothing of it", async () => {
      await page.goto(`${RETURN_PATH}?code=forged-code&state=forged-state-forged-state`);
      await expect(page).toHaveURL(/\/banks\/connect\?step=bank&error=session$/);
    });

    await test.step("turning it off from the end of its page leads to the list, and the page goes", async () => {
      // plugin-settings.md §3.3. Nothing connected: no last reading, no call to a bank.
      await pluginPage(page);
      await page.getByRole("button", { name: "Turn off Enable Banking" }).click();
      const dialog = page.getByRole("dialog", { name: "Turn off Enable Banking?" });
      await dialog.getByRole("button", { name: "Turn off Enable Banking" }).click();
      await expect(page.getByText("Enable Banking turned off: 0 accounts are now “manual”")).toBeVisible();
      await expect(page).toHaveURL(/\/settings\/plugins$/);
      await integrations(page);
      await expect(row).toHaveAttribute("data-state", "available");
      await expect(page.getByTestId("banks-card")).toHaveCount(0);
    });
  });
});

test.describe("nobody signed in", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a return ends at sign-in, with nothing exchanged", async ({ page }) => {
    await page.goto(`${RETURN_PATH}?code=forged-code&state=forged-state-forged-state`);
    await expect(page).toHaveURL(/\/sign-in/);
  });
});
