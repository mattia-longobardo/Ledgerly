// tests/e2e/wide.spec.ts — the page column on large screens (spec §8.2, F2.5). Container queries
// cannot be measured in jsdom, so the layout is checked here, in a real browser, by where things land.
import { expect, type Page, test } from "@playwright/test";
import { BASE_URL, sessionState } from "./env";

// Reads only: the Expenses user already has a synced account and this month's movements.
test.use({ storageState: sessionState("expenses") });

const SIDEBAR = { expanded: 240, collapsed: 56 } as const;

async function openAt(page: Page, width: number, sidebar: keyof typeof SIDEBAR, path: string) {
  await page.setViewportSize({ width, height: 1000 });
  await page.context().addCookies([{ name: "sidebar", value: sidebar, url: BASE_URL }]);
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeAttached();
}

async function box(page: Page, locator: ReturnType<Page["locator"]>) {
  const found = await locator.boundingBox();
  if (!found) throw new Error("not laid out");
  return found;
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

for (const width of [1280, 1920, 2560]) {
  for (const sidebar of ["expanded", "collapsed"] as const) {
    test(`the column fills ${width} px with the sidebar ${sidebar}, up to 1920 px`, async ({ page }) => {
      await openAt(page, width, sidebar, "/expenses");
      const main = await box(page, page.locator("main"));
      expect(main.width).toBeCloseTo(Math.min(1920, width - SIDEBAR[sidebar]), 0);
      for (const path of ["/", "/expenses", "/accounts", "/settings/profile"]) {
        await page.goto(path);
        expect(await horizontalOverflow(page), path).toBe(0);
      }
    });
  }
}

/**
 * Real names are long — a 40-character category, a card-terminal payee — and the seed's are not, so
 * the rows are given long text in place before measuring: the layout is what is under test.
 */
async function lengthenRows(page: Page) {
  await page.evaluate(() => {
    for (const row of document.querySelectorAll("table tbody tr")) {
      const cells = row.querySelectorAll("td");
      if (cells.length < 7) continue;
      const payee = cells[2].querySelector(".truncate");
      if (payee) payee.textContent = "Pagamento POS Supermercato Esselunga Milano Viale Certosa";
      cells[3].querySelector("span")!.textContent = "Conto Corrente Arancio Cointestato";
      const category = cells[4].querySelector("button .truncate");
      if (category) category.textContent = "Restaurant, fast-food and coffee shops";
    }
  });
}

for (const width of [1280, 1920, 2560]) {
  test(`Expenses at ${width} px: the table never scrolls sideways, and Shortcuts sits above By category`, async ({
    page,
  }) => {
    await openAt(page, width, "expanded", "/expenses");
    await lengthenRows(page);
    const scroller = page.locator("table").locator("xpath=..");
    const { scroll, client } = await scroller.evaluate((element) => ({
      scroll: element.scrollWidth,
      client: element.clientWidth,
    }));
    expect(scroll).toBeLessThanOrEqual(client);

    const [shortcuts, breakdown] = [
      await box(page, page.getByRole("heading", { name: "Shortcuts" })),
      await box(page, page.getByRole("heading", { name: "By category" })),
    ];
    expect(Math.abs(shortcuts.x - breakdown.x)).toBeLessThan(2);
    expect(breakdown.y).toBeGreaterThan(shortcuts.y);
  });
}

/**
 * A date picker opens inside the page column and on top of everything (2026-09-18): centred on its
 * button, Expenses' panel slid under the sidebar and Overview's ran off the right edge of the window.
 */
for (const [path, title] of [
  ["/expenses", "Date range"],
  ["/", "Chart range"],
] as const) {
  for (const width of [1280, 2560]) {
    test(`the date picker on ${path} opens inside the column at ${width} px`, async ({ page }) => {
      await openAt(page, width, "expanded", path);
      await page.getByTitle(title).click();
      const placement = await page.evaluate(() => {
        const panel = document.querySelector("details[open] > div")!;
        const box = panel.getBoundingClientRect();
        const main = document.querySelector("main")!.getBoundingClientRect();
        const onTop = (x: number, y: number) => panel.contains(document.elementFromPoint(x, y));
        return {
          inside: box.left >= main.left && box.right <= main.right,
          onTop: onTop(box.left + 4, box.top + 40) && onTop(box.right - 4, box.top + 40),
        };
      });
      expect(placement).toEqual({ inside: true, onTop: true });
    });
  }
}

test("Overview puts the chart and the accounts side by side only past the wide threshold", async ({
  page,
}) => {
  const chart = page.getByRole("heading", { name: "Net worth over time" });
  const accounts = page.getByRole("table");

  await openAt(page, 2560, "collapsed", "/");
  const [wideChart, wideAccounts] = [await box(page, chart), await box(page, accounts)];
  expect(wideAccounts.x).toBeGreaterThan(wideChart.x + 500);
  expect(Math.abs(wideAccounts.y - wideChart.y)).toBeLessThan(120);

  await openAt(page, 1280, "collapsed", "/");
  const [narrowChart, narrowAccounts] = [await box(page, chart), await box(page, accounts)];
  expect(narrowAccounts.y).toBeGreaterThan(narrowChart.y + 200);
});

/**
 * Settings, at every width: one section to a row — its title and description in the left column,
 * its card taking all the rest of the row — and never two sections beside each other, which would
 * halve the room each card has (owner, 2026-09-20).
 */
test("Settings gives each section the whole row, its card against the right edge", async ({ page }) => {
  const account = page.getByRole("heading", { name: "Account", level: 2 });
  const signIn = page.getByRole("heading", { name: "Sign-in", level: 2 });

  for (const width of [2560, 1280] as const) {
    await openAt(page, width, "expanded", "/settings/profile");
    const [first, second] = [await box(page, account), await box(page, signIn)];
    // One under the other, never side by side.
    expect(second.y, `at ${width}px`).toBeGreaterThan(first.y + 100);
    expect(Math.round(second.x), `at ${width}px`).toBe(Math.round(first.x));

    // The card of the first section starts to the right of its title and ends where the column
    // ends: the gap on its right is the page's own padding, nothing more.
    const gap = await page.evaluate(() => {
      const section = document.querySelector("main section")!;
      const title = section.querySelector("h2")!;
      const card = section.lastElementChild!.lastElementChild!;
      const main = document.querySelector("main")!;
      return {
        beside: Math.round(card.getBoundingClientRect().left - title.getBoundingClientRect().right),
        right: Math.round(main.getBoundingClientRect().right - card.getBoundingClientRect().right),
      };
    });
    expect(gap.beside, `title beside the card at ${width}px`).toBeGreaterThan(0);
    expect(gap.right, `card reaching the right edge at ${width}px`).toBeLessThanOrEqual(32);
  }
});
