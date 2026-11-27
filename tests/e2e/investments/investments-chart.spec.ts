// tests/e2e/investments/investments-chart.spec.ts — the chart of the Investments home by chip: «All» draws a
// layer for each service and each pension fund, «Pension funds» its funds alone, «Stocks and crypto» its
// services. A bar with no reading (null) draws no piece: never a zero. Three states for each chip — with
// data, few points, empty — at 1440 px and at 375 px. The `layout` user has services and pension funds.
import { expect, type Page, test } from "@playwright/test";
import { sessionState } from "../_shared/env";
import { THIS_YEAR } from "../_shared/helpers";

test.use({ storageState: sessionState("layout") });

/** A month long before any of the seeded data. */
const EMPTY = `from=${THIS_YEAR - 20}-01-01&to=${THIS_YEAR - 20}-01-31`;

const CHIPS = ["all", "stocks_crypto", "pension_funds"] as const;
type Chip = (typeof CHIPS)[number];

interface Layer {
  accountId: string;
  bars: (string | null)[];
}
interface Home {
  groups: { id: string; rows: { kind: string; accountId: string }[] }[];
  chart: { services: Layer[]; funds?: Layer[]; bars: (string | null)[] };
}

/** The chip in the address the chips write: «All» has none. */
const chipQuery = (chip: Chip) => (chip === "all" ? "" : `&group=${chip}`);

/** `GET /api/v1/investments/home` as the page's person, for the chip the page shows. */
async function homeOf(page: Page, query: string, chip: Chip): Promise<Home> {
  return page.evaluate(
    async (path) => (await fetch(path)).json(),
    `/api/v1/investments/home?${query}&group=${chip}`,
  );
}

/** The pieces a bar chart draws: one per layer and bar, with `data-series` the layer's account. */
const pieces = (page: Page) => page.locator("figure rect[data-series]");

/** How many pieces a layer must draw: its bars with a value other than zero; a null one draws none. */
const drawable = (layer: Layer) => layer.bars.filter((bar) => bar !== null && Number(bar) !== 0).length;

/** Every layer draws exactly its bars with a value: a null bar adds no piece. */
async function expectLayersDrawn(page: Page, home: Home): Promise<void> {
  const layers = [...home.chart.services, ...(home.chart.funds ?? [])];
  await expect(page.locator("figure").first()).toBeVisible();
  for (const layer of layers)
    await expect(page.locator(`figure rect[data-series="${layer.accountId}"]`)).toHaveCount(drawable(layer));
  await expect(pieces(page)).toHaveCount(layers.reduce((sum, layer) => sum + drawable(layer), 0));
}

const fundRows = (home: Home) =>
  home.groups
    .filter((group) => group.id === "pension_funds")
    .flatMap((group) => group.rows.map((row) => row.accountId));

test("with data: «All» has a layer for each service and each fund; each chip draws its own", async ({
  page,
}) => {
  for (const chip of CHIPS) {
    await page.goto(`/investments?preset=all${chipQuery(chip)}`);
    const home = await homeOf(page, "period=all", chip);
    const funds = (home.chart.funds ?? []).map((layer) => layer.accountId).sort();
    if (chip === "stocks_crypto") expect(funds).toEqual([]);
    else expect(funds).toEqual(fundRows(home).sort());
    if (chip === "pension_funds") expect(home.chart.services).toEqual([]);
    else expect(home.chart.services.length).toBeGreaterThan(0);
    expect(home.chart.bars.some((bar) => bar !== null)).toBe(true);
    await expectLayersDrawn(page, home);
  }
  // «All» draws the funds' pieces beside the services'.
  await page.goto("/investments?preset=all");
  const all = await homeOf(page, "period=all", "all");
  const drawnFunds = (all.chart.funds ?? []).filter((layer) => drawable(layer) > 0);
  expect(drawnFunds.length).toBeGreaterThan(0);
});

test("few points: a fund's month with no reading draws no piece, beside the months that have one", async ({
  page,
}) => {
  // The year to date, by month: a fund has a reading a month, and the month running has none yet.
  for (const chip of ["all", "pension_funds"] as const) {
    await page.goto(`/investments?preset=ytd${chipQuery(chip)}`);
    const home = await homeOf(page, `period=${THIS_YEAR}`, chip);
    const bars = (home.chart.funds ?? []).flatMap((layer) => layer.bars);
    expect(bars).toContain(null);
    expect(bars.some((bar) => bar !== null)).toBe(true);
    await expectLayersDrawn(page, home);
  }
});

test("empty: a period before any data draws nothing, on every chip", async ({ page }) => {
  for (const chip of CHIPS) {
    await page.goto(`/investments?${EMPTY}${chipQuery(chip)}`);
    await expect(page.getByText("Nothing to draw yet.")).toBeVisible();
    await expect(pieces(page)).toHaveCount(0);
  }
});

test.describe("at 375 px", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("each chip shows its chart, in every state, without a sideways scroll", async ({ page }) => {
    const states = ["preset=all", "preset=ytd", EMPTY];
    for (const chip of CHIPS)
      for (const state of states) {
        await page.goto(`/investments?${state}${chipQuery(chip)}`);
        await expect(page.getByRole("heading", { name: "Performance" })).toBeVisible();
        const wide = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(wide, `${chip} ${state}`).toBeLessThanOrEqual(375);
      }
  });
});
