// tests/e2e/investments-home.spec.ts — the P&L home of Investments (docs/design/investments-ux.md
// §2, §3.1, U2), at 1440 px, as the seeded `layout` user (Directa, Fineco, eToro, Binance): the
// period drives the hero, the parts, the chart and the rows; the rows add up to the hero; the old
// chart address lands on the new one; the period picker and the series toggle work from the keyboard.
import { expect, type Page, test } from "@playwright/test";
import { sessionState } from "./env";

test.use({ storageState: sessionState("layout") });

const hero = (page: Page) => page.getByTestId("pnl-hero");

/** Σ rows + transfers between services, in cents, from the table the wide screen shows. */
async function rowsTotal(page: Page): Promise<bigint> {
  const cents = await page
    .locator('[data-testid="service-row"] [data-testid="service-pnl"], [data-testid="transfers-row"]')
    .evaluateAll((cells) => cells.map((cell) => cell.getAttribute("data-cents") ?? "0"));
  return cents.reduce((sum, value) => sum + BigInt(value), 0n);
}

test("the period drives the hero, the parts, the chart and the rows, which add up to the hero", async ({
  page,
}) => {
  await page.goto("/investments");
  const year = page.getByRole("group", { name: "Date range" });
  await expect(year.getByRole("link", { name: "Year to date" })).toHaveAttribute("aria-current", "true");
  await expect(page.locator('[data-testid="period-text"] summary')).toHaveText(/ · year to date$/);

  const ytd = await hero(page).getAttribute("data-cents");
  expect(ytd).not.toBe("");
  expect(await rowsTotal(page)).toBe(BigInt(ytd!));
  const ytdSummary = await page.locator("figcaption").first().textContent();
  const ytdKpi = await page.getByText("Realized", { exact: true }).locator("..").textContent();

  // January, before any of the seeded data: every number of the page moves with the period, and
  // a P&L that cannot be measured says so — never a zero.
  await page.goto("/investments?from=2026-01-01&to=2026-01-31");
  // The days the picker wrote win over the presets: none of them is the current one.
  await expect(year.locator('a[aria-current="true"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="period-text"] summary')).toHaveText("January 2026");
  await expect(page.getByRole("heading", { name: /· 1 Jan 2026 – 31 Jan 2026/ })).toBeVisible();
  const january = await hero(page).getAttribute("data-cents");
  expect(january).not.toBe(ytd);
  if (january === "") {
    await expect(hero(page)).toHaveText("Not determinable");
    await expect(page.getByText("Realized", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Nothing to draw yet.")).toBeVisible();
  } else {
    expect(await rowsTotal(page)).toBe(BigInt(january!));
    expect(await page.getByText("Realized", { exact: true }).locator("..").textContent()).not.toBe(ytdKpi);
    expect(await page.locator("figcaption").first().textContent()).not.toBe(ytdSummary);
  }

  // All: from the first day with data, no stepper.
  await year.getByRole("link", { name: "All" }).click();
  await expect(page).toHaveURL(/[?&]preset=all/);
  await expect(page.locator('[data-testid="period-text"] summary')).toHaveText(/^since /);
  const all = await hero(page).getAttribute("data-cents");
  if (all !== "") expect(await rowsTotal(page)).toBe(BigInt(all!));
});

test("the stepper stops at the year running, and walks the year to date by calendar year", async ({
  page,
}) => {
  await page.goto("/investments");
  const stepper = page.getByRole("group", { name: "Date range" });
  await expect(stepper.getByRole("button", { name: "Next period" })).toBeDisabled();
  await stepper.getByRole("link", { name: "Previous period" }).click();
  await expect(page).toHaveURL(/[?&]off=1$/);
  await expect(page.locator('[data-testid="period-text"] summary')).toHaveText(
    String(new Date().getFullYear() - 1),
  );
  await stepper.getByRole("link", { name: "Latest" }).click();
  await expect(page).toHaveURL(/\/investments$/);
  await expect(page.locator('[data-testid="period-text"] summary')).toHaveText(/ · year to date$/);

  // A month steps by month, as in Expenses.
  await stepper.getByRole("link", { name: "This month" }).click();
  await expect(page).toHaveURL(/[?&]preset=thisMonth$/);
  await stepper.getByRole("link", { name: "Previous period" }).click();
  await expect(page).toHaveURL(/preset=thisMonth&off=1|off=1&preset=thisMonth/);
});

test("the charts' old address lands on the new one, and its links stay", async ({ page }) => {
  await page.goto("/investments?period=all");
  await expect(page).toHaveURL(/\/investments\?preset=all$/);
  await page.goto(`/investments?period=${new Date().getFullYear() - 1}&view=value`);
  await expect(page).toHaveURL(/view=value&off=1$/);
  await page.goto("/investments?range=all&grain=day");
  await expect(page).toHaveURL(/\/investments\?preset=all$/);
  await page.goto("/investments?from=2026-03&to=2026-05&view=value");
  await expect(page).toHaveURL(/from=2026-03-01/);
  await expect(page).toHaveURL(/to=2026-05-31/);
  await expect(page).toHaveURL(/view=value/);
  await expect(page).not.toHaveURL(/grain=/);
});

test("the Return view shows the P&L of each interval as a part of the return, on the home and in a service", async ({
  page,
}) => {
  await page.goto("/investments?view=return");
  const view = page.getByRole("group", { name: "Chart", exact: true });
  await expect(view.getByRole("link", { name: "Return %" })).toHaveAttribute("aria-current", "true");
  await expect(view.getByRole("link", { name: "P&L" })).toBeVisible();
  await expect(view.getByRole("link", { name: "Value" })).toHaveAttribute("href", /view=value/);
  // The view rides along with the period.
  await page.getByRole("group", { name: "Date range" }).getByRole("link", { name: "All" }).click();
  await expect(page).toHaveURL(/view=return&preset=all|preset=all&view=return/);

  const href = await page
    .getByTestId("service-row")
    .locator("a[href^='/investments/']")
    .first()
    .getAttribute("href");
  await page.goto(`${href!.split("?")[0]}?view=return`);
  await expect(
    page.getByRole("group", { name: "Chart", exact: true }).getByRole("link", { name: "Return %" }),
  ).toHaveAttribute("aria-current", "true");
});

test("the period picker opens and closes from the keyboard", async ({ page }) => {
  await page.goto("/investments?from=2026-01-01&to=2026-06-30");
  const summary = page.locator('summary[title="Date range"]');
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Apply" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Apply" })).toBeHidden();
  await expect(summary).toBeFocused();

  // All has no window to step, and its words open the same picker.
  await page.goto("/investments?preset=all");
  await expect(page.getByRole("link", { name: "Previous period" })).toHaveCount(0);
  await page.locator('summary[title="Date range"]').click();
  await expect(page.getByRole("button", { name: "Apply" })).toBeVisible();
});

test("a service is highlighted in the chart from the keyboard, apart from the link that opens it", async ({
  page,
}) => {
  await page.goto("/investments");
  const toggle = page
    .getByRole("button", { name: "Highlight Directa in the chart" })
    .filter({ visible: true });
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/\/investments$/);
  // The rest of the chart is dimmed, Directa stays full.
  const dimmed = await page
    .locator("svg [data-series]")
    .evaluateAll((pieces) => pieces.map((piece) => getComputedStyle(piece).opacity));
  expect(dimmed.some((opacity) => opacity === "0.3")).toBe(true);
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  // Tab goes from the toggle to the name, which opens the service with the same period.
  await toggle.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Directa", level: 1 })).toBeVisible();
});

test("PERS-145: the home's hero is the sum of the service pages, in 2026 and 2025, with no estimate and no Other", async ({
  page,
}) => {
  for (const back of ["", "?off=1"]) {
    await page.goto(`/investments${back}`);
    const heroCents = await hero(page).getAttribute("data-cents");
    const links = await page
      .getByTestId("service-row")
      .locator("a[href^='/investments/']")
      .evaluateAll((anchors) => [...new Set(anchors.map((one) => one.getAttribute("href")!))]);
    expect(links.length).toBeGreaterThan(0);
    await expectNothingEstimated(page);
    let services = 0n;
    for (const href of links) {
      await page.goto(href);
      const cents = await hero(page).getAttribute("data-cents");
      if (cents) services += BigInt(cents);
      await expectNothingEstimated(page);
    }
    // A service that cannot be measured is left out of both, never counted as zero.
    if (heroCents) expect(services, back || "the year running").toBe(BigInt(heroCents));
  }
});

/** No dashed history, no "estimated", no "What is missing", no "Other (…)" (PERS-145 · 3, 4). */
async function expectNothingEstimated(page: Page): Promise<void> {
  const main = page.getByRole("main");
  await expect(main.getByText(/estimat|What is missing|Other \(/i)).toHaveCount(0);
  expect(await page.locator("main svg [stroke-dasharray]").count()).toBe(0);
}
