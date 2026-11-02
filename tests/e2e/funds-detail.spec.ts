// tests/e2e/funds-detail.spec.ts — a fund's page (docs/design/funds-ux.md §5.3, §6, F3), with the invented
// funds of the `fundsDetail` seed.
import { expect, type Page, test } from "@playwright/test";
import { sessionState } from "./env";

const HOME = "/funds";
const Y = new Date().getFullYear();

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

  for (const name of ["PAC Piano", "Pensione Beta"]) {
    for (const query of ["", `?period=${Y - 1}`, `?period=${Y - 2}`, "?period=all"]) {
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
    await page.goto(await fundPath(page, "PAC Piano"));
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
    await page.goto(`${HOME}?period=${Y - 1}`);
    await row(page, "PAC Piano").getByRole("link", { name: "PAC Piano" }).click();
    await expect(page).toHaveURL(new RegExp(`period=${Y - 1}$`));
    await expect(page.getByTestId("period-text")).toHaveText(String(Y - 1));
    const tabs = page.getByRole("navigation", { name: "Fund" });
    await tabs.getByRole("link", { name: "Valuations" }).click();
    await expect(page).toHaveURL(new RegExp(`period=${Y - 1}&tab=valuations|tab=valuations&period=${Y - 1}`));
    await tabs.getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(new RegExp(`period=${Y - 1}`));
    await tabs.getByRole("link", { name: "Overview" }).click();
    await expect(page.getByTestId("period-text")).toHaveText(String(Y - 1));
    await page.locator(`header a[href="${HOME}?period=${Y - 1}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/funds\\?period=${Y - 1}$`));
    await expect(page.getByTestId("period-text")).toHaveText(String(Y - 1));
  });

  test("Back walks the tabs and the periods", async ({ page }) => {
    const path = await fundPath(page, "Pensione Beta");
    await page.goto(path);
    await expect(page.getByTestId("period-text")).toHaveText(`${Y} · year to date`);
    const start = await hero(page).textContent();

    await page
      .getByRole("group", { name: "Year", exact: true })
      .getByRole("link", { name: "Previous year" })
      .click();
    await expect(page.getByTestId("period-text")).toHaveText(String(Y - 1));
    const last = await hero(page).getAttribute("data-cents");
    await page.getByRole("group", { name: "Period", exact: true }).getByRole("link", { name: "All" }).click();
    await expect(page).toHaveURL(/period=all/);
    await page.getByRole("navigation", { name: "Fund" }).getByRole("link", { name: "Contributions" }).click();
    await expect(page.getByTestId("fund-operations")).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/period=all$/);
    await expect(page.getByTestId("funds-hero")).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId("period-text")).toHaveText(String(Y - 1));
    await expect(hero(page)).toHaveAttribute("data-cents", last!);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(hero(page)).toHaveText(start!);
    await page.goForward();
    await expect(page.getByTestId("period-text")).toHaveText(String(Y - 1));
  });

  test("one return on the page, with XIRR in its tooltip from 365 days", async ({ page }) => {
    const path = await fundPath(page, "PAC Piano");
    await page.goto(`${path}?period=${Y - 2}`);
    const rate = page.getByTestId("funds-rate");
    await expect(rate).toHaveCount(1);
    await expect(rate).not.toHaveAttribute("title");
    await page.goto(`${path}?period=all`);
    await expect(rate).toHaveAttribute("title", /XIRR/);
    // Not the compound of the old page either.
    await expect(page.getByTestId("pension-returns")).toHaveCount(0);
    await expect(page.getByText(/compound|at its own|Simple Dietz|not annualised/i)).toHaveCount(0);
    await expect(page.locator("main").getByText(/^[+−-]\d.*%$/)).toHaveCount(1);
  });

  test("the plan and this month's status stay as of today; a past year says its value and today's", async ({
    page,
  }) => {
    const path = await fundPath(page, "PAC Piano");
    await page.goto(path);
    const plan = await page.getByTestId("kpi-plan").textContent();
    expect(plan).toContain("250,00");
    expect(plan).toContain("Deposit found");
    const projection = await page.getByTestId("fund-projection").textContent();
    await expect(page.getByTestId("fund-value-today")).toHaveCount(0);

    await page.goto(`${path}?period=${Y - 1}`);
    expect(await page.getByTestId("kpi-plan").textContent()).toBe(plan);
    expect(await page.getByTestId("fund-projection").textContent()).toBe(projection);
    await expect(page.getByTestId("fund-value")).toContainText("Value at year end");
    await expect(page.getByTestId("fund-value")).toContainText("1.600,00");
    await expect(page.getByTestId("fund-value-today")).toContainText("1.900,00");
  });

  test("the projection of a PAC stands on its plan", async ({ page }) => {
    await page.goto(await fundPath(page, "PAC Piano"));
    await expect(page.getByTestId("fund-projection")).toContainText("If the plan stays at 250,00");
    await page.getByTestId("fund-projection").getByText("See all the rates").click();
    await expect(page.getByTestId("fund-projection").locator("table")).toBeVisible();
    // Horizon, paid in and the three hypotheses: the fund's own rate would be a second return.
    await expect(page.getByTestId("fund-projection").locator("thead th")).toHaveCount(5);
  });

  test("the pension fund: on the way by quarter, as of today; the bridge; the projection closed", async ({
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

    await page.goto(`${path}?period=${Y - 1}`);
    expect(await notice.textContent()).toBe(coming);
    await expect(page.getByTestId("kpi-deductible")).toContainText("500,00");
    await expect(page.getByTestId("recent-flow")).toHaveCount(2);
    await expect(page.getByTestId("recent-flow").first()).toContainText(`II ${Y - 1}`);
    await page.goto(`${path}?period=all`);
    await expect(page.getByTestId("kpi-deductible")).toHaveCount(0);
  });

  test("a reading behind the money is not a loss", async ({ page }) => {
    const path = await fundPath(page, "PAC Piano");
    await page.goto(`${path}?period=all&view=value`);
    await page.getByTestId("fund-performance").getByText("Chart data").click();
    // One point per reading, nothing in between, and the money that reading could see.
    await expect(page.getByTestId("fund-performance").locator("details table tbody tr")).toHaveCount(3);
    await expect(page.locator('svg rect[data-band="neg"]')).toHaveCount(0);
  });

  test("Settings do not follow the period, and work as today", async ({ page }) => {
    const path = await fundPath(page, "Pensione Beta");
    await page.goto(`${path}?tab=settings&period=${Y - 1}`);
    await expect(page.getByRole("group", { name: "Period", exact: true })).toHaveCount(0);
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
    const path = await fundPath(page, "PAC Piano");
    await page.goto(`${path}?period=${Y - 9}`);
    await expect(page.getByText(`No data in ${Y - 9}`)).toBeVisible();
    await expect(page.getByRole("link", { name: `Go to ${Y - 2}` })).toBeVisible();
    await page.goto(`${path}?period=${Y + 1}`);
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await page.goto(`${path}?span=12`);
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await page.goto(`${path}?span=60`);
    await expect(page).toHaveURL(new RegExp(`${path}\\?period=all$`));
    await page.goto(`${path}?from=${Y - 1}-01&to=${Y - 1}-03`);
    await expect(page).toHaveURL(new RegExp(`from=${Y - 1}-01-01&to=${Y - 1}-03-31`));
  });

  test("another person's fund and an address that is no id answer 404", async ({ page, browser }) => {
    const other = await browser.newContext({ storageState: sessionState("fundsHome") });
    const theirs = await other.newPage();
    await theirs.goto(HOME);
    const href = await row(theirs, "PAC Beta").getByRole("link", { name: "PAC Beta" }).getAttribute("href");
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
      await expect(page.getByRole("button", { name: "Record value" }).first()).toBeVisible();
    });

    test("an archived fund: its badge, its gain, and a last value that is not held today", async ({
      page,
    }) => {
      await page.goto(`${HOME}?period=all`);
      const gamma = page.getByTestId("fund-home-row").filter({ hasText: "PAC Gamma" });
      const cents = await gamma.getByTestId("fund-gain").getAttribute("data-cents");
      await gamma.getByRole("link", { name: "PAC Gamma" }).click();
      await expect(hero(page)).toHaveAttribute("data-cents", cents!);
      await expect(page.locator("h1")).toContainText("Archived");
      await expect(page.getByTestId("fund-value")).toContainText("Last value");
      await expect(page.getByRole("button", { name: "Record value" })).toHaveCount(0);
    });

    test("a past year with no value: the last one known, and today's", async ({ page }) => {
      await page.goto(`${HOME}?period=${Y - 1}`);
      await page
        .getByTestId("fund-home-row")
        .filter({ hasText: "PAC Beta" })
        .getByRole("link", { name: "PAC Beta" })
        .click();
      await expect(hero(page)).toHaveText(`No value in ${Y - 1}`);
      await expect(page.getByTestId("fund-value")).toContainText("Last value");
      await expect(page.getByTestId("fund-value-today")).toContainText("3.300,00");
    });

    test("a year of payslips alone: not determinable, with where to go", async ({ page }) => {
      await page.goto(`${HOME}?period=${Y - 4}`);
      await page
        .getByTestId("payslips-only")
        .getByRole("link", { name: `Open the contributions of ${Y - 4}` })
        .click();
      await expect(page).toHaveURL(new RegExp(`period=${Y - 4}`));
      await expect(page.getByTestId("fund-payslips")).toBeVisible();
      await page.getByRole("navigation", { name: "Fund" }).getByRole("link", { name: "Overview" }).click();
      await expect(hero(page)).toHaveText("Not determinable");
      await expect(page.getByTestId("kpi-accrued")).toBeVisible();
      await expect(page.getByTestId("payslips-only")).toBeVisible();
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
    await expect(page.getByRole("group", { name: "Period", exact: true })).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Fund" }).getByRole("link", { name: "Settings" }),
    ).toBeVisible();
    await expect(page.getByTestId("fund-bridge")).toBeVisible();
    await expect(page.getByTestId("fund-projection").locator("summary")).toBeVisible();
    await expect(
      page.getByTestId("recent-flow").or(page.getByText("No deposit in this period.")),
    ).not.toHaveCount(0);
    await expect(page.getByRole("button", { name: /Record value/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Import/ }).first()).toBeVisible();
  });
});
