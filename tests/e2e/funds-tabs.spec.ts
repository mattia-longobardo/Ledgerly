// tests/e2e/funds-tabs.spec.ts — the tabs of a fund's page (docs/design/funds-ux.md §4, §5.3, §6, F4; one set
// of tabs for every fund since release N6, docs/design/rewrite-plan/ux/n6-pension-fund.md §5), with the
// invented funds of the `fundsDetail` seed.
import { expect, type Page, test } from "@playwright/test";
import { sessionState } from "./env";
import { THIS_YEAR } from "./helpers";

// The tests of this file change the data of one user, each from what the one before left: they run
// in order, on one worker, while the other files run beside them (playwright.preview.config.ts).
test.describe.configure({ mode: "default" });

const HOME = "/funds";
const Y = THIS_YEAR;

test.describe("the tabs", () => {
  test.use({ storageState: sessionState("fundsDetail") });

  async function fundPath(page: Page, name: string): Promise<string> {
    await page.goto(HOME);
    const href = await page
      .getByTestId("fund-home-row")
      .filter({ hasText: name })
      .getByRole("link", { name })
      .getAttribute("href");
    return href!.split("?")[0];
  }
  /** A loading skeleton is a `<main>` too, and it says nothing about the page. */
  const main = (page: Page) => page.locator('main:not([data-testid$="-loading"])');
  const periodControl = (page: Page) => page.getByRole("group", { name: "Date range" }).first();

  for (const [name, tab, testId] of [
    ["Piano Uno", "contributions", "contribution-row"],
    ["Piano Uno", "valuations", "valuation-line"],
    ["Pensione Beta", "contributions", "contribution-row"],
    ["Pensione Beta", "valuations", "valuation-line"],
  ] as const) {
    test(`${name}, ${tab}: the period filters the rows, with the control in view`, async ({ page }) => {
      const path = await fundPath(page, name);
      await page.goto(`${path}?tab=${tab}&preset=all`);
      await expect(periodControl(page)).toBeVisible();
      const rows = page.getByTestId(testId);
      const all = await rows.count();
      expect(all).toBeGreaterThan(1);

      // Walk the stepper from the control itself: the tab stays, and the rows change.
      await page.goto(`${path}?tab=${tab}`);
      await page
        .getByRole("group", { name: "Date range" })
        .getByRole("link", { name: "Previous period" })
        .click();
      await expect(page).toHaveURL(new RegExp(`off=1`));
      await expect(page).toHaveURL(new RegExp(`tab=${tab}`));
      await expect(page.locator('[data-testid="period-text"] summary')).toHaveText(String(Y - 1));
      const year = await rows.count();
      expect(year).toBeGreaterThan(0);
      expect(year).toBeLessThan(all);
      // Every date in the row belongs to the period, a reading on 1 January closing the year before.
      for (const on of await rows.evaluateAll((list) => list.map((one) => one.getAttribute("data-on")!))) {
        expect(on >= `${Y - 1}-01-01` && on <= `${Y}-01-01`, on).toBe(true);
      }
      // A span inside the fund's life with nothing in it: no row, and the control stays.
      await page.goto(`${path}?tab=${tab}&from=${Y - 1}-06-01&to=${Y - 1}-06-30`);
      await expect(periodControl(page)).toBeVisible();
      await expect(rows).toHaveCount(0);
    });
  }

  test("the Contributions tab adds up to the Overview's paid in; the debit stays in every period", async ({
    page,
  }) => {
    const path = await fundPath(page, "Piano Uno");
    await page.goto(`${path}?off=1`);
    const paid = (await page.getByTestId("kpi-paid").locator("span").nth(1).textContent())!.trim();
    await page.goto(`${path}?tab=contributions&off=1`);
    // What was charged, before the fees: the column the Overview's "Paid in" adds up.
    await expect(page.getByTestId("contributions-voluntary-total")).toHaveText(paid);
    await expect(page.getByTestId("fund-deposit-rule")).toBeVisible();
    await page.goto(`${path}?tab=contributions&off=9`);
    await expect(page.getByText(`No data in ${Y - 9}`)).toBeVisible();
  });

  test("the stretch return says what it is, and appears only in Values", async ({ page }) => {
    const path = await fundPath(page, "Piano Uno");
    await page.goto(`${path}?tab=valuations&preset=all`);
    await expect(page.getByRole("columnheader", { name: "Stretch return" })).toBeVisible();
    await expect(page.getByTestId("stretch-rate-note")).toContainText("not the return of the period");
    await expect(page.getByTestId("line-rate").first()).toHaveText(/%$/);
    await page.goto(`${path}?preset=all`);
    await expect(main(page)).not.toContainText("Stretch return");
    await page.goto(`${path}?tab=contributions&preset=all`);
    await expect(main(page)).not.toContainText("Stretch return");
  });

  test("Contributions: payslips, periods and operations follow the period", async ({ page }) => {
    const path = await fundPath(page, "Pensione Beta");
    await page.goto(`${path}?tab=contributions&off=1`);
    await expect(page.getByTestId("payslip-line")).toHaveCount(2);
    await expect(page.getByTestId("contribution-row")).toHaveCount(2);
    await expect(page.getByTestId("quarter-line").first()).toContainText(`${Y - 1}`);
    await page.goto(`${path}?tab=contributions&preset=all`);
    await expect(page.getByTestId("payslip-line")).toHaveCount(3);
    await expect(page.getByTestId("contribution-row")).toHaveCount(5);
  });

  test.describe("the phone", () => {
    /** Every control a tab has, by name: what a wide screen offers cannot be missing from the narrow one. */
    const controls = async (page: Page) => {
      const names = await page
        .locator("main")
        .getByRole("button")
        .or(main(page).getByRole("link"))
        .evaluateAll((list) =>
          list
            .filter((one) => (one as HTMLElement).offsetParent !== null)
            .map((one) => (one.getAttribute("aria-label") ?? one.textContent ?? "").trim()),
        );
      return [...new Set(names)].sort();
    };

    for (const [name, tab, row, item] of [
      ["Piano Uno", "contributions", "contribution-row", "contribution-item"],
      ["Piano Uno", "valuations", "valuation-line", "valuation-item"],
      ["Pensione Beta", "contributions", "contribution-row", "contribution-item"],
      ["Pensione Beta", "valuations", "valuation-line", "valuation-item"],
    ] as const) {
      test(`${name}, ${tab}: the same controls at 400 px as at 1440 px`, async ({ page }) => {
        const path = await fundPath(page, name);
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(`${path}?tab=${tab}&preset=all`);
        await expect(page.getByTestId(row).first()).toBeVisible();
        await expect(page.getByTestId(item).first()).toBeHidden();
        const wide = await controls(page);
        const rows = await page.getByTestId(row).count();

        await page.setViewportSize({ width: 400, height: 860 });
        await page.goto(`${path}?tab=${tab}&preset=all`);
        await expect(page.getByTestId(item).first()).toBeVisible();
        await expect(page.getByTestId(row).first()).toBeHidden();
        await expect(page.getByTestId(item)).toHaveCount(rows);
        expect(await controls(page)).toEqual(wide);
        await expect(periodControl(page)).toBeVisible();
      });
    }

    test("Contributions keeps its Delete in the list", async ({ page }) => {
      const path = await fundPath(page, "Pensione Beta");
      await page.setViewportSize({ width: 400, height: 860 });
      await page.goto(`${path}?tab=contributions&off=2`);
      // The one row written by hand: a row a document left before release N6 has no action.
      await expect(
        page.getByTestId("contribution-item").getByRole("button", { name: /^Delete the contribution of/ }),
      ).toHaveCount(1);
      await expect(
        page.getByTestId("contribution-item").getByRole("button", { name: /^Delete the contribution of/ }),
      ).toBeVisible();
    });
  });

  test("a returns address with no fund in it answers 404, and a span that is no span is ignored", async ({
    page,
  }) => {
    const bad = await page.request.get(`${HOME}/not%0D%0Aan-id/returns`, { maxRedirects: 0 });
    expect(bad.status()).toBe(404);
    const euro = await page.request.get(`${HOME}/%E2%82%AC/returns`, { maxRedirects: 0 });
    expect(euro.status()).toBe(404);
    const path = await fundPath(page, "Piano Uno");
    await page.goto(`${path}?span=99999999999`);
    expect(new URL(page.url()).search).toBe("");
    await page.goto(`${path}?span=abc`);
    expect(new URL(page.url()).search).toBe("");
  });

  test("the old returns page goes to Values, with its period", async ({ page }) => {
    const path = await fundPath(page, "Piano Uno");
    await page.goto(`${path}/returns?off=1`);
    await expect(page).toHaveURL(new RegExp(`${path}\\?tab=valuations&off=1$`));
    await expect(page.getByTestId("fund-valuations")).toBeVisible();
    await page.goto(`${path}/returns?span=60`);
    await expect(page).toHaveURL(new RegExp(`${path}\\?tab=valuations&preset=all$`));
    await page.goto(`${path}/returns?from=${Y - 1}-01&to=${Y - 1}-03`);
    await expect(page).toHaveURL(new RegExp(`from=${Y - 1}-01-01&to=${Y - 1}-03-31`));
  });

  // Release N6 (docs/design/rewrite-plan/ux/n6-pension-fund.md §2): the tab of the debits is the one of
  // every contribution, and a fund reads no document any more.
  test("the old Deposits address goes to Contributions, with its period", async ({ page }) => {
    const path = await fundPath(page, "Piano Uno");
    /** Where the address led: the fund's own page, with exactly these parameters, in any order. */
    const landed = async (expected: Record<string, string>) => {
      await expect(page).toHaveURL(/tab=contributions/);
      const url = new URL(page.url());
      expect(url.pathname).toBe(path);
      expect(Object.fromEntries(url.searchParams)).toEqual({ tab: "contributions", ...expected });
    };
    await page.goto(`${path}?tab=deposits&period=${Y - 1}`);
    await landed({ off: "1" });
    await expect(page.locator('[data-testid="period-text"] summary')).toHaveText(String(Y - 1));
    await expect(page.getByTestId("fund-contributions")).toBeVisible();
    await expect(page.getByTestId("contribution-row")).toHaveCount(1);
    await page.goto(`${path}?tab=deposits&period=all`);
    await landed({ preset: "all" });
    await page.goto(`${path}?tab=deposits&from=${Y - 1}-01-01&to=${Y - 1}-03-31`);
    await landed({ from: `${Y - 1}-01-01`, to: `${Y - 1}-03-31` });
    await page.goto(`${path}?tab=deposits`);
    await landed({});
  });

  test("the address of a fund's document answers 404, and no tab offers to import one", async ({ page }) => {
    const path = await fundPath(page, "Pensione Beta");
    const id = "01a1dbff-d9b5-7197-bd7c-585e5592cec1";
    for (const address of [
      `${path}/documents/${id}`,
      `${path}/documents/${id}/original`,
      `${path}/documents/anything`,
      `${path}/documents`,
    ]) {
      const response = await page.request.get(address, { maxRedirects: 0 });
      expect(response.status(), address).toBe(404);
    }
    expect((await page.goto(`${path}/documents/${id}`))?.status()).toBe(404);
    await expect(page.getByTestId("funds-hero")).toHaveCount(0);
    for (const tab of ["overview", "contributions", "valuations", "settings"]) {
      await page.goto(`${path}?tab=${tab}&preset=all`);
      await expect(main(page)).toBeVisible();
      await expect(page.getByRole("button", { name: /Import/ }), tab).toHaveCount(0);
      await expect(page.locator('a[href*="/documents/"]'), tab).toHaveCount(0);
      await expect(page.getByTestId("fund-documents"), tab).toHaveCount(0);
    }
  });

  test.describe("an operation that is not a contribution", () => {
    // "Fondo Uscita" of the `fundsSetup` seed: 5.000,00 € paid in, worth 5.600,00 € yesterday.
    test.use({ storageState: sessionState("fundsSetup") });

    test("an exit is in the register with a minus sign, and the gain does not fall by its amount", async ({
      page,
    }) => {
      await page.goto(`${HOME}?preset=all`);
      const href = await page
        .getByTestId("fund-home-row")
        .filter({ hasText: "Fondo Uscita" })
        .getByRole("link", { name: "Fondo Uscita" })
        .getAttribute("href");
      const path = href!.split("?")[0];
      const gain = async () => {
        await page.goto(`${path}?preset=all`);
        return BigInt((await page.getByTestId("funds-hero").getAttribute("data-cents")) || "0");
      };
      const before = await gain();
      expect(before).toBe(60_000n);

      await page.goto(`${path}?tab=contributions&preset=all`);
      await expect(page.getByTestId("contribution-row")).toHaveCount(1);
      await page
        .getByTestId("fund-contributions")
        .getByRole("button", { name: "Record contribution" })
        .click();
      const dialog = page.getByRole("dialog", { name: "Record contribution · Fondo Uscita" });
      await dialog.getByRole("button", { name: "Other operation" }).click();
      await expect(dialog.getByLabel("Operation").locator("option")).toHaveText([
        "Enrolment",
        "Transfer in",
        "Compartment switch",
        "Withdrawal",
      ]);
      await dialog.getByLabel("Operation").selectOption({ label: "Withdrawal" });
      await expect(dialog).toContainText("it does not count as a loss");
      await dialog.getByLabel("Amount").fill("500");
      await dialog.getByRole("button", { name: "Save contribution" }).click();
      await expect(dialog).toBeHidden();

      // The row: the operation's name, and what left with a minus sign.
      await expect(page.getByTestId("contribution-row")).toHaveCount(2);
      const exit = page.getByTestId("contribution-row").filter({ hasText: "Withdrawal" });
      await expect(exit).toHaveCount(1);
      await expect(exit).toContainText("−500,00 €");
      // Paid in 5.000,00 − 500,00 = 4.500,00 € net.
      await expect(page.getByTestId("contributions-total")).toHaveText("4.500,00 €");

      // The money that left is no loss: with the value still the one of before the exit, the gain
      // is not 500,00 € lower.
      const after = await gain();
      expect(after).not.toBe(before - 50_000n);
      expect(after).toBeGreaterThanOrEqual(before);

      // And once the fund's value says the money is gone, the gain is the one of before, to the cent.
      await page.getByRole("banner").getByRole("button", { name: "Update value" }).click();
      const value = page.getByRole("dialog", { name: "Update value · Fondo Uscita" });
      await value.getByLabel("Value (€)").fill("5100");
      await value.getByRole("button", { name: "Save value" }).click();
      await expect(value).toBeHidden();
      expect(await gain()).toBe(before);
      await expect(page.getByTestId("fund-value")).toContainText("5.100,00 €");
    });
  });

  test("a value recorded by hand opens its Edit dialog from the tab, and the dialog speaks the new words", async ({
    page,
  }) => {
    const path = await fundPath(page, "Piano Uno");
    await page.goto(`${path}?tab=valuations&preset=all`);
    await page.getByTestId("valuation-line").first().getByRole("button", { name: "Edit" }).click();
    await expect(page.getByRole("dialog")).toContainText("Edit value");
    await expect(page.getByRole("dialog")).toContainText("Value (€)");
    await page.keyboard.press("Escape");
  });

  test.describe("the words of the new pages", () => {
    // §4, n. 17 and 18. "XIRR" stays in a tooltip, which `innerText` does not read.
    const WORDS = {
      en: /Simple Dietz|not annualised|Cumulative|Competence|QUOTATO|\bTER\b|Current value|Position value|Valuation record|Still to be credited/,
      it: /Simple Dietz|non annualizzat|Cumulato|cumulato|Competenz|competenz|QUOTATO|\bTER\b|Valore attuale|Valore posizione|Riepilog|riepilog|Valorizzazion|valorizzazion|Da accreditare/,
    };
    // One set of tabs for every fund (release N6).
    const TABS = ["overview", "contributions", "valuations", "settings"] as const;
    const FUNDS = ["Piano Uno", "Pensione Beta"] as const;

    for (const [language, session] of [
      ["en", "fundsDetail"],
      ["it", "fundsCopy"],
    ] as const) {
      test.describe(language, () => {
        test.use({ storageState: sessionState(session) });

        for (const name of FUNDS) {
          test(`${name}: no technical word on any tab, nor in the value dialog`, async ({ page }) => {
            const path = await fundPath(page, name);
            for (const tab of TABS) {
              await page.goto(`${path}?tab=${tab}&preset=all`);
              await expect(main(page)).toBeVisible();
              const text = await main(page).innerText();
              expect(text, `${tab}: ${text.match(WORDS[language])?.[0]}`).not.toMatch(WORDS[language]);
            }
            await page.goto(`${path}?preset=all`);
            await page
              .getByRole("button", { name: language === "en" ? "Update value" : "Aggiorna valore" })
              .first()
              .click();
            const dialog = await page.getByRole("dialog").innerText();
            expect(dialog).not.toMatch(WORDS[language]);
          });
        }

        test("the home has no technical word", async ({ page }) => {
          await page.goto(`${HOME}?preset=all`);
          await expect(main(page)).toBeVisible();
          expect(await main(page).innerText()).not.toMatch(WORDS[language]);
        });
      });
    }

    test.describe("the tab names, in Italian", () => {
      test.use({ storageState: sessionState("fundsCopy") });

      test("are the ones §6 asks for", async ({ page }) => {
        const path = await fundPath(page, "Pensione Beta");
        await page.goto(path);
        const tabs = page.getByRole("navigation", { name: "Fondo" });
        for (const name of ["Panoramica", "Contributi", "Valori", "Impostazioni"]) {
          await expect(tabs.getByRole("link", { name })).toBeVisible();
        }
      });
    });
  });
});
