// tests/e2e/funds-home.spec.ts — the Funds home (docs/design/funds-ux.md §5.3, §6, F2), with the
// invented years of the `fundsHome` seed.
import { expect, type Page, test } from "@playwright/test";
import { sessionState } from "./env";

const PATH = "/funds";
const Y = new Date().getFullYear();

test.use({ storageState: sessionState("fundsHome") });

test("the address of the preview does not answer any more", async ({ page }) => {
  const response = await page.goto("/funds/preview");
  expect(response?.status()).toBe(404);
  await expect(page.getByTestId("funds-hero")).toHaveCount(0);
});

test("the Contributions tab says a fee is unknown, and a debit with no amount reads well", async ({
  page,
}) => {
  await page.goto(`${PATH}?preset=all`);
  await page.getByRole("link", { name: "PAC Delta" }).filter({ visible: true }).first().click();
  await page.getByRole("navigation", { name: "Fund" }).getByRole("link", { name: "Contributions" }).click();
  await expect(page.getByTestId("fee-unknown")).toContainText("A fee is unknown");
  // The debit's own card: what it looks for, with no amount and no fee in the sentence.
  const debit = page.getByTestId("fund-deposit-rule");
  await expect(debit).toContainText("Active");
  await expect(debit).toContainText("every month · from any account · payee contains “Delta”");
  await expect(debit).not.toContainText("€");
});

test.describe("the home", () => {
  const hero = (page: Page) => page.getByTestId("funds-hero");
  const heroCents = async (page: Page) => BigInt((await hero(page).getAttribute("data-cents")) || "0");

  async function rowsTotal(page: Page): Promise<bigint> {
    const cents = await page
      .locator('[data-testid="fund-home-row"] [data-testid="fund-gain"]')
      .evaluateAll((cells) => cells.map((cell) => cell.getAttribute("data-cents") ?? "0"));
    return cents.reduce((sum, value) => sum + BigInt(value), 0n);
  }

  test("defaults to the year running, and the period drives the hero, the KPIs, the chart and the rows", async ({
    page,
  }) => {
    await page.goto(PATH);
    const period = page.getByRole("group", { name: "Date range" });
    await expect(period.getByRole("link", { name: "Year to date" })).toHaveAttribute("aria-current", "true");
    await expect(page.locator('[data-testid="period-text"] summary')).toHaveText(`${Y} · year to date`);
    await expect(hero(page)).toHaveAttribute("data-state", "partial");
    expect(await rowsTotal(page)).toBe(await heroCents(page));
    const paid = await page.getByTestId("kpi-paid").textContent();
    const market = await page.getByTestId("kpi-market").textContent();
    const fees = await page.getByTestId("kpi-fees").textContent();
    const chart = await page.locator("figcaption").first().textContent();
    const who = await page.getByTestId("who-paid").textContent();
    const onTheWay = await page.getByTestId("kpi-on-the-way").textContent();

    await page.goto(`${PATH}?off=3`);
    await expect(hero(page)).toHaveAttribute("data-state", "measured");
    expect(await rowsTotal(page)).toBe(await heroCents(page));
    expect(await page.getByTestId("kpi-paid").textContent()).not.toBe(paid);
    expect(await page.getByTestId("kpi-market").textContent()).not.toBe(market);
    expect(await page.getByTestId("kpi-fees").textContent()).not.toBe(fees);
    expect(await page.locator("figcaption").first().textContent()).not.toBe(chart);
    expect(await page.getByTestId("who-paid").textContent()).not.toBe(who);
    // On the way stays as of today.
    expect(await page.getByTestId("kpi-on-the-way").textContent()).toBe(onTheWay);
  });

  test("All: the years add up to it, to the cent", async ({ page }) => {
    await page.goto(`${PATH}?preset=all`);
    await expect(page.locator('[data-testid="period-text"] summary')).toHaveText(/^since /);
    const cents = await page
      .getByTestId("year-row")
      .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-cents") ?? ""));
    expect(cents).toHaveLength(5);
    const total = cents.reduce((sum, value) => sum + BigInt(value || "0"), 0n);
    expect(total).toBe(await heroCents(page));
    expect(await rowsTotal(page)).toBe(total);
    // The archived fund has its badge here, since it has data, and its old value is not held today.
    const gamma = page.getByTestId("fund-home-row").filter({ hasText: "PAC Gamma" });
    await expect(gamma.getByText("Archived")).toBeVisible();
    await expect(gamma).not.toContainText("410,00");
    await expect(page.getByText(/Value 3\.960,00/)).toBeVisible();
    // The fees of a year with no measure wait for the next value: the column adds up to its total.
    await expect(page.locator(`[data-testid="year-row"][data-year="${Y - 2}"] td`).nth(3)).toHaveText("—");
  });

  test("a year with payslips alone: not determinable, never zero, with where to go", async ({ page }) => {
    await page.goto(`${PATH}?off=4`);
    await expect(hero(page)).toHaveAttribute("data-state", "payslips_only");
    await expect(hero(page)).toHaveAttribute("data-cents", "");
    await expect(hero(page)).toHaveText("Not determinable");
    await expect(page.getByTestId("kpi-accrued")).toContainText("Pensione Alfa");
    await expect(
      page.getByTestId("payslips-only").getByRole("link", { name: `Go to ${Y - 3}` }),
    ).toBeVisible();
    await expect(
      page.getByTestId("payslips-only").getByRole("link", { name: `Open the contributions of ${Y - 4}` }),
    ).toBeVisible();
  });

  test("a year with money and no value: not determinable, the money stands", async ({ page }) => {
    await page.goto(`${PATH}?off=2`);
    await expect(hero(page)).toHaveAttribute("data-state", "paid_no_value");
    await expect(hero(page)).toHaveText("Not determinable");
    await expect(page.getByTestId("kpi-paid")).toContainText("500,00");
    await expect(page.getByTestId("kpi-fees")).toContainText("0,50");
    await expect(page.getByText(`Record a value to measure the gain in ${Y - 2}.`)).toBeVisible();
    await expect(page.getByText(/Last value/)).toBeVisible();
  });

  test("a year with nothing: no value, and the last one known with its date", async ({ page }) => {
    await page.goto(`${PATH}?off=1`);
    await expect(hero(page)).toHaveAttribute("data-state", "quiet");
    await expect(hero(page)).toHaveText(`No value in ${Y - 1}`);
    await expect(page.getByText(/Last value/)).toBeVisible();
    await expect(page.getByTestId("chart-empty")).toBeVisible();
  });

  test("the year running: a fund with no value keeps its row and its action, out of the sum", async ({
    page,
  }) => {
    await page.goto(PATH);
    const delta = page.getByTestId("fund-home-row").filter({ hasText: "PAC Delta" });
    await expect(delta.getByRole("button", { name: "Record the first value" })).toBeVisible();
    await expect(delta.getByTestId("fund-gain")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: new RegExp(`^Gain available · ${Y}`) })).toBeVisible();
    await expect(page.getByText(/out of the sum/)).toBeVisible();
    // The pension fund's value is old: one link, with its date.
    await expect(page.getByRole("link", { name: /to update: Pensione Alfa/ })).toBeVisible();
  });

  test("a year before the data has a link to the first; a year to come goes back to this one", async ({
    page,
  }) => {
    await page.goto(`${PATH}?off=9`);
    await expect(page.getByText(`No data in ${Y - 9}`)).toBeVisible();
    await expect(page.getByRole("link", { name: `Go to ${Y - 4}` })).toBeVisible();
    await page.goto(`${PATH}?period=${Y + 1}`);
    await expect(page).toHaveURL(new RegExp(`${PATH}$`));
    await expect(page.locator('[data-testid="period-text"] summary')).toHaveText(`${Y} · year to date`);
  });

  test("the stepper stops at the year running, and a month steps by month", async ({ page }) => {
    const stepper = page.getByRole("group", { name: "Date range" });
    await page.goto(PATH);
    await expect(stepper.getByRole("button", { name: "Next period" })).toBeDisabled();
    await stepper.getByRole("link", { name: "Previous period" }).click();
    await expect(page).toHaveURL(new RegExp(`off=1`));
    await expect(page.locator('[data-testid="period-text"] summary')).toHaveText(String(Y - 1));
    await stepper.getByRole("link", { name: "Last 3 months" }).click();
    await expect(page).toHaveURL(/preset=last3Months$/);
    await expect(stepper.getByRole("link", { name: "Last 3 months" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    await stepper.getByRole("link", { name: "Previous period" }).click();
    await expect(page).toHaveURL(/preset=last3Months&off=1|off=1&preset=last3Months/);
  });

  test("a value of the 1st of January closes the year before; the money stays on its own day", async ({
    page,
  }) => {
    // PAC Beta reads 2.100,00 € on 1 Jan Y−2: that closes Y−3, on 2.000,00 € paid in.
    await page.goto(`${PATH}?off=3`);
    const beta = page.getByTestId("fund-home-row").filter({ hasText: "PAC Beta" });
    expect(BigInt((await beta.getByTestId("fund-gain").getAttribute("data-cents"))!)).toBe(10_000n);
    await expect(beta).toContainText("01 Jan");
    // So Y−2 has money and no value of its own, even with a reading on its first day.
    await page.goto(`${PATH}?off=2`);
    await expect(hero(page)).toHaveAttribute("data-state", "paid_no_value");
    // The money stays on its own day: 300,00 € of 1 Jan Y is in Y, in the gain up to today's value.
    await page.goto(PATH);
    await expect(beta).toContainText("300,00");
    expect(BigInt((await beta.getByTestId("fund-gain").getAttribute("data-cents"))!)).toBe(40_000n);
  });

  test("the Return view shows each interval's part of the return, in percent", async ({ page }) => {
    await page.goto(`${PATH}?preset=all&view=return`);
    const chart = page.getByTestId("fund-performance");
    await expect(chart.getByRole("link", { name: "Return %" })).toHaveAttribute("aria-current", "true");
    // The period stays when the view changes, and the view stays when the period does.
    await expect(chart.getByRole("link", { name: "Gain" })).toHaveAttribute("href", /preset=all/);
    await expect(
      page.getByRole("group", { name: "Date range" }).getByRole("link", { name: "Year to date" }),
    ).toHaveAttribute("href", /view=return/);
    const rate = page.getByTestId("funds-rate");
    if ((await rate.count()) === 0) {
      await expect(chart.getByTestId("chart-empty")).toBeVisible();
      return;
    }
    await chart.getByText("Chart data").click();
    await expect(chart.getByRole("columnheader", { name: "Return %" })).toBeVisible();
    const cells = await chart.locator("tbody tr td:nth-child(2)").allTextContents();
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) expect(cell).toMatch(/%$|^—$/);
  });

  test("the Value view shows the readings, and a deposit between two of them is not a loss", async ({
    page,
  }) => {
    await page.goto(`${PATH}?preset=all&view=value`);
    await page.getByText("Chart data").click();
    const dates = page.locator("details table tbody tr");
    const count = await dates.count();
    // Three readings of PAC Beta, one of Pensione Alfa, one of PAC Gamma: no month in between.
    expect(count).toBe(5);
    await expect(page.locator('svg rect[data-band="neg"]')).toHaveCount(0);
  });

  test("the phone has the same controls", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(PATH);
    const delta = page.getByTestId("fund-home-item").filter({ hasText: "PAC Delta" });
    await expect(delta.getByRole("button", { name: "Record the first value" })).toBeVisible();
    const beta = page.getByTestId("fund-home-item").filter({ hasText: "PAC Beta" });
    await expect(beta.getByRole("button", { name: /Highlight PAC Beta/ })).toBeVisible();
    await expect(beta.getByRole("link", { name: "PAC Beta" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Date range" }).first()).toBeVisible();
    await expect(page.getByTestId("fund-home-row").first()).toBeHidden();
  });
});
