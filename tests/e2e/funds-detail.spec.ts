// tests/e2e/funds-detail.spec.ts — a fund's page (docs/design/funds-ux.md §5.3, §6, F3; one model for
// every fund since release N6, docs/design/rewrite-plan/ux/n6-pension-fund.md), with the invented
// funds of the `fundsDetail` seed.
import { expect, type Page, test } from "@playwright/test";
import { sessionState } from "./env";
import { THIS_YEAR } from "./helpers";

const HOME = "/funds";
const Y = THIS_YEAR;

test.describe("a fund's page", () => {
  test.use({ storageState: sessionState("fundsDetail") });

  const row = (page: Page, name: string) => page.getByTestId("fund-home-row").filter({ hasText: name });
  const hero = (page: Page) => page.getByTestId("funds-hero");

  /** The fund's own address, read from its link in the home. */
  async function fundPath(page: Page, name: string): Promise<string> {
    await page.goto(HOME);
    const href = await row(page, name).getByRole("link", { name }).getAttribute("href");
    return href!.split("?")[0];
  }

  for (const name of ["Piano Uno", "Pensione Beta"]) {
    for (const query of ["", `?off=1`, `?off=2`, "?preset=all"]) {
      test(`${name}: the same gain and the same return as the home, ${query || "the year running"}`, async ({
        page,
      }) => {
        await page.goto(`${HOME}${query}`);
        const home = row(page, name);
        const cents = await home.getByTestId("fund-gain").getAttribute("data-cents");
        const rate = await home.getByTestId("fund-rate").textContent();
        const paid = await home.locator("td").nth(1).textContent();
        await home.getByRole("link", { name }).click();
        await expect(page).toHaveURL(new RegExp(`/funds/[0-9a-f-]+${query.replace("?", "\\?")}$`));
        await expect(hero(page)).toHaveAttribute("data-cents", cents!);
        await expect(page.getByTestId("funds-rate")).toHaveText(rate!);
        await expect(page.getByTestId("kpi-paid")).toContainText(paid!);
      });
    }
  }

  test("market − fees = gain, on the page of a fund", async ({ page }) => {
    await page.goto(await fundPath(page, "Piano Uno"));
    const amount = async (id: string) =>
      Number(
        (await page.getByTestId(id).locator("span").nth(1).textContent())!
          .replace(/[^\d,−-]/g, "")
          .replace("−", "-")
          .replace(",", "."),
      );
    const gain = Number(await hero(page).getAttribute("data-cents")) / 100;
    expect((await amount("kpi-market")) + (await amount("kpi-fees"))).toBeCloseTo(gain, 2);
  });

  test("the period stays from the home to the fund, from tab to tab, and back to the home", async ({
    page,
  }) => {
    await page.goto(`${HOME}?off=1`);
    await row(page, "Piano Uno").getByRole("link", { name: "Piano Uno" }).click();
    await expect(page).toHaveURL(new RegExp(`off=1$`));
    await expect(page.locator('[data-testid="period-text"] summary')).toHaveText(String(Y - 1));
    const tabs = page.getByRole("navigation", { name: "Fund" });
    await tabs.getByRole("link", { name: "Values" }).click();
    await expect(page).toHaveURL(new RegExp(`off=1&tab=valuations|tab=valuations&off=1`));
    await tabs.getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(new RegExp(`off=1`));
    await tabs.getByRole("link", { name: "Overview" }).click();
    await expect(page.locator('[data-testid="period-text"] summary')).toHaveText(String(Y - 1));
    await page.locator(`header a[href="${HOME}?off=1"]`).click();
    await expect(page).toHaveURL(new RegExp(`/funds\\?off=1$`));
    await expect(page.locator('[data-testid="period-text"] summary')).toHaveText(String(Y - 1));
  });

  test("Back walks the tabs and the periods", async ({ page }) => {
    const path = await fundPath(page, "Pensione Beta");
    await page.goto(path);
    await expect(page.locator('[data-testid="period-text"] summary')).toHaveText(`${Y} · year to date`);
    const start = await hero(page).textContent();

    await page
      .getByRole("group", { name: "Date range" })
      .getByRole("link", { name: "Previous period" })
      .click();
    await expect(page.locator('[data-testid="period-text"] summary')).toHaveText(String(Y - 1));
    const last = await hero(page).getAttribute("data-cents");
    await page.getByRole("group", { name: "Date range" }).getByRole("link", { name: "All" }).click();
    await expect(page).toHaveURL(/preset=all/);
    await page.getByRole("navigation", { name: "Fund" }).getByRole("link", { name: "Contributions" }).click();
    await expect(page.getByTestId("fund-contributions")).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/preset=all$/);
    await expect(page.getByTestId("funds-hero")).toBeVisible();
    await page.goBack();
    await expect(page.locator('[data-testid="period-text"] summary')).toHaveText(String(Y - 1));
    await expect(hero(page)).toHaveAttribute("data-cents", last!);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(hero(page)).toHaveText(start!);
    await page.goForward();
    await expect(page.locator('[data-testid="period-text"] summary')).toHaveText(String(Y - 1));
  });

  test("one return on the page, with XIRR in its tooltip from 365 days", async ({ page }) => {
    const path = await fundPath(page, "Piano Uno");
    await page.goto(`${path}?off=2`);
    const rate = page.getByTestId("funds-rate");
    await expect(rate).toHaveCount(1);
    await expect(rate).not.toHaveAttribute("title");
    await page.goto(`${path}?preset=all`);
    await expect(rate).toHaveAttribute("title", /XIRR/);
    // Not the compound of the old page either.
    await expect(page.getByTestId("pension-returns")).toHaveCount(0);
    await expect(page.getByText(/compound|at its own|Simple Dietz|not annualised/i)).toHaveCount(0);
    await expect(page.locator("main").getByText(/^[+−-]\d.*%$/)).toHaveCount(1);
  });

  test("the debit and this month's status stay as of today; a past year says its value and today's", async ({
    page,
  }) => {
    const path = await fundPath(page, "Piano Uno");
    await page.goto(path);
    const plan = await page.getByTestId("kpi-debit").textContent();
    expect(plan).toContain("250,00");
    expect(plan).toContain("Deposit found");
    const projection = await page.getByTestId("fund-projection").textContent();
    await expect(page.getByTestId("fund-value-today")).toHaveCount(0);

    await page.goto(`${path}?off=1`);
    expect(await page.getByTestId("kpi-debit").textContent()).toBe(plan);
    expect(await page.getByTestId("fund-projection").textContent()).toBe(projection);
    await expect(page.getByTestId("fund-value")).toContainText("Value at year end");
    await expect(page.getByTestId("fund-value")).toContainText("1.600,00");
    await expect(page.getByTestId("fund-value-today")).toContainText("1.900,00");
  });

  test("the projection of a fund with a debit stands on its plan", async ({ page }) => {
    await page.goto(await fundPath(page, "Piano Uno"));
    await expect(page.getByTestId("fund-projection")).toContainText("If the plan stays at 250,00");
    await page.getByTestId("fund-projection").getByText("See all the rates").click();
    await expect(page.getByTestId("fund-projection").locator("table")).toBeVisible();
    // Horizon, paid in and the three hypotheses: the fund's own rate would be a second return.
    await expect(page.getByTestId("fund-projection").locator("thead th")).toHaveCount(5);
  });

  test("the fund fed by the payslip: on the way by period, as of today; the bridge; the projection closed", async ({
    page,
  }) => {
    const path = await fundPath(page, "Pensione Beta");
    await page.goto(path);
    const notice = page.getByTestId("fund-on-the-way");
    await expect(notice).toContainText("600,00");
    await expect(notice).toContainText(`${Y}`);
    const coming = await notice.textContent();
    await expect(page.getByTestId("fund-meta")).toContainText("Crescita");
    await expect(page.getByTestId("fund-value")).toContainText("200 units");
    await expect(page.getByTestId("fund-bridge")).toContainText("From accrued to value");
    await expect(page.getByTestId("fund-projection")).not.toHaveAttribute("open", "");

    await page.goto(`${path}?off=1`);
    expect(await notice.textContent()).toBe(coming);
    await expect(page.getByTestId("recent-flow")).toHaveCount(2);
    await expect(page.getByTestId("recent-flow").first()).toContainText(`Q2 ${Y - 1}`);
    await expect(page.getByTestId("kpi-deductible")).toHaveCount(0);
  });

  test("a reading behind the money is not a loss", async ({ page }) => {
    const path = await fundPath(page, "Piano Uno");
    await page.goto(`${path}?preset=all&view=value`);
    await page.getByTestId("fund-performance").getByText("Chart data").click();
    // One point per reading, nothing in between, and the money that reading could see.
    await expect(page.getByTestId("fund-performance").locator("details table tbody tr")).toHaveCount(3);
    await expect(page.locator('svg rect[data-band="neg"]')).toHaveCount(0);
  });

  test("Settings do not follow the period, and work as today", async ({ page }) => {
    const path = await fundPath(page, "Pensione Beta");
    await page.goto(`${path}?tab=settings&off=1`);
    await expect(page.getByRole("group", { name: "Date range" })).toHaveCount(0);
    await expect(
      page
        .getByRole("button", { name: "Archive this fund" })
        .or(page.getByRole("button", { name: /Archive/ }))
        .first(),
    ).toBeVisible();
  });

  test("a year before the data links to the first; a year to come goes back; an old address opens", async ({
    page,
  }) => {
    const path = await fundPath(page, "Piano Uno");
    await page.goto(`${path}?off=9`);
    await expect(page.getByText(`No data in ${Y - 9}`)).toBeVisible();
    await expect(page.getByRole("link", { name: `Go to ${Y - 2}` })).toBeVisible();
    await page.goto(`${path}?period=${Y + 1}`);
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await page.goto(`${path}?span=12`);
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await page.goto(`${path}?span=60`);
    await expect(page).toHaveURL(new RegExp(`${path}\\?preset=all$`));
    await page.goto(`${path}?from=${Y - 1}-01&to=${Y - 1}-03`);
    await expect(page).toHaveURL(new RegExp(`from=${Y - 1}-01-01&to=${Y - 1}-03-31`));
  });

  test("another person's fund and an address that is no id answer 404", async ({ page, browser }) => {
    const other = await browser.newContext({ storageState: sessionState("fundsHome") });
    const theirs = await other.newPage();
    await theirs.goto(HOME);
    const href = await row(theirs, "Piano Beta")
      .getByRole("link", { name: "Piano Beta" })
      .getAttribute("href");
    expect((await theirs.goto(href!))?.status()).toBe(200);
    await other.close();
    expect((await page.goto(href!))?.status()).toBe(404);
    await expect(page.getByTestId("funds-hero")).toHaveCount(0);
    expect((await page.goto(`${HOME}/not-a-fund`))?.status()).toBe(404);
  });

  test.describe("a fund with no value in the year running", () => {
    test.use({ storageState: sessionState("fundsHome") });

    test("no value yet, never zero: the last one with its date, and the action", async ({ page }) => {
      await page.goto(HOME);
      await page
        .getByTestId("fund-home-row")
        .filter({ hasText: "Pensione Alfa" })
        .getByRole("link", { name: "Pensione Alfa" })
        .click();
      await expect(hero(page)).toHaveAttribute("data-cents", "");
      await expect(hero(page)).toHaveText(`No value yet in ${Y}`);
      await expect(page.getByTestId("fund-value")).toContainText("Last value");
      await expect(page.getByRole("button", { name: "Update value" }).first()).toBeVisible();
    });

    test("an archived fund: its badge, its gain, and a last value that is not held today", async ({
      page,
    }) => {
      await page.goto(`${HOME}?preset=all`);
      const gamma = page.getByTestId("fund-home-row").filter({ hasText: "Piano Gamma" });
      const cents = await gamma.getByTestId("fund-gain").getAttribute("data-cents");
      await gamma.getByRole("link", { name: "Piano Gamma" }).click();
      await expect(hero(page)).toHaveAttribute("data-cents", cents!);
      await expect(page.locator("h1")).toContainText("Archived");
      await expect(page.getByTestId("fund-value")).toContainText("Last value");
      await expect(page.getByRole("button", { name: "Update value" })).toHaveCount(0);
    });

    test("a past year with no value: the last one known, and today's", async ({ page }) => {
      await page.goto(`${HOME}?off=1`);
      await page
        .getByTestId("fund-home-row")
        .filter({ hasText: "Piano Beta" })
        .getByRole("link", { name: "Piano Beta" })
        .click();
      await expect(hero(page)).toHaveText(`No value in ${Y - 1}`);
      await expect(page.getByTestId("fund-value")).toContainText("Last value");
      await expect(page.getByTestId("fund-value-today")).toContainText("3.300,00");
    });

    test("a year of payslips alone: not determinable, with where to go", async ({ page }) => {
      await page.goto(`${HOME}?off=4`);
      await page
        .getByTestId("payslips-only")
        .getByRole("link", { name: `Open the contributions of ${Y - 4}` })
        .click();
      await expect(page).toHaveURL(new RegExp(`off=4`));
      await expect(page.getByTestId("fund-payslips")).toBeVisible();
      await page.getByRole("navigation", { name: "Fund" }).getByRole("link", { name: "Overview" }).click();
      await expect(hero(page)).toHaveText("Not determinable");
      await expect(page.getByTestId("kpi-accrued")).toBeVisible();
      await expect(page.getByTestId("payslips-only")).toBeVisible();
    });
  });

  // Release N6 (docs/design/rewrite-plan/ux/n6-pension-fund.md §10.4, §10.5): the sections come from the
  // fund's sources, never from a kind, and in every empty state the action by hand comes first.
  test.describe("a fund with no source", () => {
    test.use({ storageState: sessionState("fundsSetup") });

    test("no payslip section, no debit section, and the two actions in the empty states", async ({
      page,
    }) => {
      await page.goto(`${HOME}?preset=all`);
      const href = await page
        .getByRole("link", { name: "Fondo Vuoto", exact: true })
        .filter({ visible: true })
        .first()
        .getAttribute("href");
      const path = href!.split("?")[0];
      const banner = page.getByRole("banner");

      await test.step("Overview: the first steps, and nothing a source would add", async () => {
        await page.goto(path);
        await expect(page.getByTestId("fund-meta")).toHaveText(/^Esempio · since /);
        // Only "Update value" at the top: "Record contribution" goes there with "One-off payments".
        await expect(banner.getByRole("button", { name: "Update value" })).toBeVisible();
        await expect(banner.getByRole("button", { name: "Record contribution" })).toHaveCount(0);
        const first = page.getByTestId("fund-first-steps");
        await expect(first.getByRole("button", { name: "Record contribution" })).toBeVisible();
        await expect(first.getByRole("button", { name: "Update value" })).toBeVisible();
        for (const id of [
          "fund-alert",
          "fund-on-the-way",
          "kpi-debit",
          "kpi-accrued",
          "kpi-deductible",
          "fund-bridge",
        ]) {
          await expect(page.getByTestId(id), id).toHaveCount(0);
        }
        await expect(page.getByTestId("kpi-paid")).toContainText("0,00 €");
        await expect(page.getByTestId("kpi-paid")).toContainText("no contribution");
        await expect(page.getByTestId("kpi-market")).toContainText("needs a value");
        const recent = page.getByTestId("fund-recent");
        await expect(recent).toContainText("No contribution in this period.");
        await expect(recent.getByRole("button", { name: "Record contribution" })).toBeVisible();
        await expect(page.getByRole("button", { name: /Import/ })).toHaveCount(0);
      });

      await test.step("Contributions: the register alone, with its action", async () => {
        await page.goto(`${path}?tab=contributions`);
        const empty = page.getByTestId("contributions-empty");
        await expect(empty).toContainText("No contribution yet.");
        // No source feeds this fund: nothing "arrives automatically".
        await expect(empty).not.toContainText("arrive automatically");
        for (const id of ["fund-payslips", "fund-quarters", "fund-deposit-rule", "fund-deductible"]) {
          await expect(page.getByTestId(id), id).toHaveCount(0);
        }
        await empty.getByRole("button", { name: "Record contribution" }).click();
        const dialog = page.getByRole("dialog", { name: "Record contribution · Fondo Vuoto" });
        await expect(dialog.getByRole("button", { name: "Voluntary" })).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        // The period is the payslip source's: with no such source the field is not there.
        await dialog.getByRole("button", { name: "From the payslip" }).click();
        await expect(dialog.getByLabel("My contribution")).toBeVisible();
        await expect(dialog.getByLabel("Period")).toHaveCount(0);
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
      });

      await test.step("Values: the empty state offers the first value", async () => {
        await page.goto(`${path}?tab=valuations`);
        const empty = page.getByTestId("valuations-empty");
        await expect(empty).toContainText("No value yet. Record the first one to measure the fund.");
        await empty.getByRole("button", { name: "Update value" }).click();
        await expect(page.getByRole("dialog", { name: "Update value · Fondo Vuoto" })).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.getByTestId("fund-statements")).toHaveCount(0);
        await expect(page.getByTestId("fund-documents")).toHaveCount(0);
      });

      await test.step("Settings: no source and no fee, each with its action", async () => {
        await page.goto(`${path}?tab=settings`);
        const sources = page.getByTestId("fund-sources");
        await expect(sources).toContainText("No source");
        await expect(sources.getByRole("button", { name: "Add source" })).toBeVisible();
        await expect(page.getByTestId("source-row")).toHaveCount(0);
        const fees = page.getByTestId("fund-fees");
        await expect(fees).toContainText("Fees not set");
        await expect(fees.getByRole("button", { name: "Add fee" })).toBeVisible();
      });
    });
  });

  test("the phone has the same controls", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(HOME);
    const href = await page
      .getByTestId("fund-home-item")
      .filter({ hasText: "Pensione Beta" })
      .getByRole("link", { name: "Pensione Beta" })
      .getAttribute("href");
    await page.goto(href!);
    await expect(page.getByRole("group", { name: "Date range" }).first()).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Fund" }).getByRole("link", { name: "Settings" }),
    ).toBeVisible();
    await expect(page.getByTestId("fund-bridge")).toBeVisible();
    await expect(page.getByTestId("fund-projection").locator("summary")).toBeVisible();
    await expect(
      page.getByTestId("recent-flow").or(page.getByText("No contribution in this period.")),
    ).not.toHaveCount(0);
    await expect(page.getByRole("button", { name: /Update value/ }).first()).toBeVisible();
    // A fund reads no document any more (release N6): nothing offers to import one.
    await expect(page.getByRole("button", { name: /Import/ })).toHaveCount(0);
  });
});
