// tests/e2e/funds/mobile.spec.ts — the flow `funds` at the width of a phone (400 px: the project
// `mobile` of playwright.config.ts runs every `mobile.spec.ts`).
import { expect, type Page, test } from "@playwright/test";
import { sessionState } from "../_shared/env";
import { LAST_YEAR } from "../_shared/helpers";

/**
 * The pension fund of release N6 at 400 px (docs/design/rewrite-plan/ux/n6-pension-fund.md §11.1): the form
 * that creates a fund, and a fund's page with its one set of tabs. Seeded sessions: no password sign-in.
 */
test.describe("the form of a fund on a phone", () => {
  test.use({ storageState: sessionState("fundsSetup") });

  const overflow = (page: Page) =>
    page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  test("each step fits the screen, with the step's command first and as wide as the card", async ({
    page,
  }) => {
    await page.goto("/funds/new");
    const form = page.getByTestId("fund-wizard");
    const card = (name: string) => page.getByTestId(`wizard-step-${name}`);
    const steps = page.getByRole("list", { name: "Steps" });
    // Under 480 px a step that is not the current one shows its number alone; its name stays for a reader.
    await expect(steps.locator('[aria-current="step"]')).toContainText("The fund");
    await expect(steps.getByText("How you pay in")).toHaveClass(/sr-only/);
    expect(await overflow(page)).toBeLessThanOrEqual(0);

    /** The primary command sits above the other one, and both are as wide as the card's content. */
    const stacked = async (name: string, primary: string, other: string) => {
      const first = await card(name).getByRole("button", { name: primary }).boundingBox();
      const second = await card(name)
        .getByRole("button", { name: other })
        .or(card(name).getByRole("link", { name: other }))
        .boundingBox();
      expect(first!.y, `${primary} is not above ${other}`).toBeLessThan(second!.y);
      expect(first!.width, `${primary} is not full width`).toBeGreaterThan(300);
      expect(Math.abs(first!.width - second!.width)).toBeLessThanOrEqual(1);
    };

    await form.getByLabel("Name").fill("Fondo Telefono");
    await form.getByLabel("Member since").fill(`${LAST_YEAR}-03-01`);
    await stacked("fund", "Continue", "Cancel");
    await card("fund").getByRole("button", { name: "Continue" }).click();

    // Every source switched on: the rows with a switch are tall enough for a thumb, and nothing overflows.
    for (const kind of ["payroll", "bank_debit", "manual"]) {
      const toggle = page.getByTestId(`source-switch-${kind}`);
      await toggle.tap();
      await expect(toggle).toHaveAttribute("aria-checked", "true");
      // The row is the nearest ancestor that has a box of its own: a wrapper may be `display: contents`.
      const height = await toggle.evaluate((element) => {
        let row = element.parentElement;
        while (row && row.getBoundingClientRect().height === 0) row = row.parentElement;
        return row?.getBoundingClientRect().height ?? 0;
      });
      expect(height, `the row of ${kind} is under 44 px`).toBeGreaterThanOrEqual(44);
    }
    await expect(steps.locator('[aria-current="step"]')).toContainText("How you pay in");
    await expect(steps.getByText("The fund")).toHaveClass(/sr-only/);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await stacked("sources", "Continue", "Back");
    // Nothing is created: the journey stops here, and leaving asks first.
    await page.getByTestId("source-switch-bank_debit").tap();
    await page.getByTestId("source-switch-payroll").tap();
    await card("sources").getByRole("button", { name: "Continue" }).click();
    await expect(card("fees")).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await stacked("fees", "Skip for now", "Back");
    await card("fees").getByRole("button", { name: "Skip for now" }).click();
    await expect(card("review")).toContainText("One-off payments");
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await stacked("review", "Create fund", "Back");
  });
});

test.describe("a fund's page on a phone", () => {
  test.use({ storageState: sessionState("fundsDetail") });

  for (const fund of ["Piano Uno", "Pensione Beta"]) {
    test(`${fund}: the four tabs are on one row, and no tab scrolls the page sideways`, async ({ page }) => {
      await page.goto("/funds?preset=all");
      const href = await page
        .getByTestId("fund-home-item")
        .filter({ hasText: fund })
        .getByRole("link", { name: fund })
        .getAttribute("href");
      const path = href!.split("?")[0];
      await page.goto(path);
      const tabs = page.getByRole("navigation", { name: "Fund" });
      const tops: number[] = [];
      for (const name of ["Overview", "Contributions", "Values", "Settings"]) {
        const box = await tabs.getByRole("link", { name }).boundingBox();
        tops.push(box!.y);
      }
      // The current tab sits a pixel lower than the others; a second row would be a whole line down.
      expect(Math.max(...tops) - Math.min(...tops), "the tabs wrap onto a second row").toBeLessThan(8);
      // "Update value" stays in the top bar.
      await expect(page.getByRole("banner").getByRole("button", { name: "Update value" })).toBeVisible();
      for (const tab of ["overview", "contributions", "valuations", "settings"]) {
        await page.goto(`${path}?tab=${tab}&preset=all`);
        await expect(page.getByRole("heading", { name: fund, level: 1 })).toBeVisible();
        const sideways = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(sideways, `${tab} scrolls sideways`).toBeLessThanOrEqual(0);
      }
      // The register is a list here, with the same commands as the table of a wide screen.
      await page.goto(`${path}?tab=contributions&preset=all`);
      await expect(page.getByTestId("contribution-item").first()).toBeVisible();
      await expect(page.getByTestId("contribution-row").first()).toBeHidden();
      await expect(
        page.getByTestId("fund-contributions").getByRole("button", { name: "Record contribution" }),
      ).toBeVisible();
    });
  }
});
