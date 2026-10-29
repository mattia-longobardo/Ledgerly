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
  const year = page.getByRole("group", { name: "Period" });
  await expect(year.getByRole("link", { name: "Year" })).toHaveAttribute("aria-current", "true");
  await expect(page.getByTestId("period-text")).toHaveText(/ · year to date$/);

  const ytd = await hero(page).getAttribute("data-cents");
  expect(ytd).not.toBe("");
  expect(await rowsTotal(page)).toBe(BigInt(ytd!));
  const ytdSummary = await page.locator("figcaption").first().textContent();
  const ytdKpi = await page.getByText("Realized", { exact: true }).locator("..").textContent();

  // January, before any of the seeded data: every number of the page moves with the period, and
  // a P&L that cannot be measured says so — never a zero.
  await page.goto("/investments?from=2026-01-01&to=2026-01-31");
  await expect(year.getByRole("link", { name: "Custom" })).toHaveAttribute("aria-current", "true");
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
  await expect(page).toHaveURL(/[?&]period=all/);
  await expect(page.getByTestId("period-text")).toHaveText(/^since /);
  const all = await hero(page).getAttribute("data-cents");
  if (all !== "") expect(await rowsTotal(page)).toBe(BigInt(all!));
});

test("the stepper stops at the first year with data and at the year running", async ({ page }) => {
  await page.goto("/investments");
  const stepper = page.getByRole("group", { name: "Year" });
  await expect(stepper.getByRole("button", { name: "Next year" })).toBeDisabled();
  // Every seeded movement is of this year.
  await expect(stepper.getByRole("button", { name: "Previous year" })).toBeDisabled();
});

test("the charts' old address lands on the new one, and its links stay", async ({ page }) => {
  await page.goto("/investments?range=all&grain=day");
  await expect(page).toHaveURL(/\/investments\?period=all$/);
  await page.goto("/investments?from=2026-03&to=2026-05&view=value");
  await expect(page).toHaveURL(/from=2026-03-01/);
  await expect(page).toHaveURL(/to=2026-05-31/);
  await expect(page).toHaveURL(/view=value/);
  await expect(page).not.toHaveURL(/grain=/);
});

test("the period picker opens, offers the shortcuts and closes from the keyboard", async ({ page }) => {
  await page.goto("/investments?from=2026-01-01&to=2026-06-30");
  const summary = page.locator('summary[title="Pick the days"]');
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("link", { name: "Last 12 months" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Apply" })).toBeHidden();
  await expect(summary).toBeFocused();

  await summary.click();
  await page.getByRole("link", { name: "Last 12 months" }).click();
  await expect(page).toHaveURL(/from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/);
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
