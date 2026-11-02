// tests/e2e/funds-tabs.spec.ts — the tabs of a fund's new page (docs/design/funds-ux.md §4, §5.3, §6, F4), with
// the invented funds of the `fundsDetail` seed. In a local preview it drives the tabs; on the deployed site the
// old pages stay, and the new routes do not answer, until F5 connects them.
import { expect, type Page, test } from "@playwright/test";
import { FUNDS_HOME_PREVIEW, sessionState } from "./env";

const HOME = "/funds/preview";
const Y = new Date().getFullYear();

test.describe("on the deployed site", () => {
  test.skip(FUNDS_HOME_PREVIEW, "it answers in a local preview");
  test.use({ storageState: sessionState("layout") });

  test("the new tabs and the redirect do not answer, and the old returns page still does", async ({
    page,
  }) => {
    await page.goto("/funds");
    const href = await page
      .getByRole("link", { name: /Fideuram/ })
      .filter({ visible: true })
      .first()
      .getAttribute("href");
    const id = href!.split("/").at(-1)!.split("?")[0];
    for (const path of ["?tab=deposits", "?tab=valuations", "?tab=contributions&period=all", "/returns"]) {
      expect((await page.goto(`${HOME}/${id}${path}`))?.status(), path).toBe(404);
    }
    const old = await page.goto(`/funds/${id}/returns`);
    expect(old?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe(`/funds/${id}/returns`);
    const span = await page.goto(`/funds/${id}?span=24`);
    expect(span?.status()).toBe(200);
    expect(page.url()).toContain("span=24");
  });
});

test.describe("in a preview", () => {
  test.skip(!FUNDS_HOME_PREVIEW, "it answers only in a local preview until F5 connects it");
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
  const periodControl = (page: Page) => page.getByRole("group", { name: "Period", exact: true });

  for (const [name, tab, testId] of [
    ["PAC Piano", "deposits", "deposit-line"],
    ["PAC Piano", "valuations", "valuation-line"],
    ["Pensione Beta", "contributions", "operation-line"],
    ["Pensione Beta", "valuations", "valuation-line"],
  ] as const) {
    test(`${name}, ${tab}: the period filters the rows, with the control in view`, async ({ page }) => {
      const path = await fundPath(page, name);
      await page.goto(`${path}?tab=${tab}&period=all`);
      await expect(periodControl(page)).toBeVisible();
      const rows = page.getByTestId(testId);
      const all = await rows.count();
      expect(all).toBeGreaterThan(1);

      // Walk the stepper from the control itself: the tab stays, and the rows change.
      await page.goto(`${path}?tab=${tab}`);
      await page
        .getByRole("group", { name: "Year", exact: true })
        .getByRole("link", { name: "Previous year" })
        .click();
      await expect(page).toHaveURL(new RegExp(`period=${Y - 1}`));
      await expect(page).toHaveURL(new RegExp(`tab=${tab}`));
      await expect(page.getByTestId("period-text")).toHaveText(String(Y - 1));
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

  test("the Deposits tab adds up to the Overview's paid in; the rule stays in every period", async ({
    page,
  }) => {
    const path = await fundPath(page, "PAC Piano");
    await page.goto(`${path}?period=${Y - 1}`);
    const paid = (await page.getByTestId("kpi-paid").locator("span").nth(1).textContent())!.trim();
    await page.goto(`${path}?tab=deposits&period=${Y - 1}`);
    await expect(page.getByTestId("deposits-total")).toHaveText(paid);
    await expect(page.getByTestId("fund-deposit-rule")).toBeVisible();
    await page.goto(`${path}?tab=deposits&period=${Y - 9}`);
    await expect(page.getByText(`No data in ${Y - 9}`)).toBeVisible();
  });

  for (const name of ["PAC Piano", "Pensione Beta"]) {
    for (const query of ["", `?period=${Y - 1}`, `?period=${Y - 2}`, "?period=all"]) {
      test(`${name}: Σ of the stretches = the gain of the Overview, ${query || "the year running"}`, async ({
        page,
      }) => {
        const path = await fundPath(page, name);
        await page.goto(`${path}${query}`);
        const gain = BigInt((await page.getByTestId("funds-hero").getAttribute("data-cents")) || "0");
        await page.goto(`${path}${query}${query ? "&" : "?"}tab=valuations`);
        const cells = await page
          .getByTestId("line-gain")
          .evaluateAll((list) => list.map((one) => one.getAttribute("data-cents") ?? ""));
        expect(cells.reduce((sum, one) => sum + BigInt(one || "0"), 0n)).toBe(gain);
      });
    }
  }

  test("the stretch return says what it is, and appears only in Valuations", async ({ page }) => {
    const path = await fundPath(page, "PAC Piano");
    await page.goto(`${path}?tab=valuations&period=all`);
    await expect(page.getByRole("columnheader", { name: "Stretch return" })).toBeVisible();
    await expect(page.getByTestId("stretch-rate-note")).toContainText("not the return of the period");
    await expect(page.getByTestId("line-rate").first()).toHaveText(/%$/);
    await page.goto(`${path}?period=all`);
    await expect(main(page)).not.toContainText("Stretch return");
    await page.goto(`${path}?tab=deposits&period=all`);
    await expect(main(page)).not.toContainText("Stretch return");
  });

  test("the deductible is you + employer, no TFR, with the note on the certified year", async ({ page }) => {
    const path = await fundPath(page, "Pensione Beta");
    await page.goto(`${path}?period=${Y - 1}`);
    const kpi = (await page.getByTestId("kpi-deductible").locator("span").nth(1).textContent())!.trim();
    await page.goto(`${path}?tab=contributions&period=${Y - 1}`);
    // Two operations of 100,00 + 150,00, with 350,00 of TFR each that must not count.
    await expect(page.getByTestId("deductible-line")).toHaveCount(1);
    await expect(page.getByTestId("deductible-line")).toHaveAttribute("data-cents", "50000");
    await expect(page.getByTestId("deductible-line")).toContainText(kpi);
    await expect(page.getByTestId("deductible-note")).toContainText("TFR excluded");
    await expect(page.getByTestId("deductible-note")).toContainText("certifies can differ");
  });

  test("Contributions: payslips, quarters and operations follow the period", async ({ page }) => {
    const path = await fundPath(page, "Pensione Beta");
    await page.goto(`${path}?tab=contributions&period=${Y - 1}`);
    await expect(page.getByTestId("payslip-line")).toHaveCount(2);
    await expect(page.getByTestId("operation-line")).toHaveCount(2);
    await expect(page.getByTestId("quarter-line").first()).toContainText(`${Y - 1}`);
    await page.goto(`${path}?tab=contributions&period=all`);
    await expect(page.getByTestId("payslip-line")).toHaveCount(3);
    await expect(page.getByTestId("operation-line")).toHaveCount(5);
    await expect(page.getByTestId("deductible-line")).toHaveCount(3);
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
      ["PAC Piano", "deposits", "deposit-line", "deposit-item"],
      ["PAC Piano", "valuations", "valuation-line", "valuation-item"],
      ["Pensione Beta", "contributions", "operation-line", "operation-line-item"],
      ["Pensione Beta", "valuations", "valuation-line", "valuation-item"],
    ] as const) {
      test(`${name}, ${tab}: the same controls at 400 px as at 1440 px`, async ({ page }) => {
        const path = await fundPath(page, name);
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(`${path}?tab=${tab}&period=all`);
        await expect(page.getByTestId(row).first()).toBeVisible();
        await expect(page.getByTestId(item).first()).toBeHidden();
        const wide = await controls(page);
        const rows = await page.getByTestId(row).count();

        await page.setViewportSize({ width: 400, height: 860 });
        await page.goto(`${path}?tab=${tab}&period=all`);
        await expect(page.getByTestId(item).first()).toBeVisible();
        await expect(page.getByTestId(row).first()).toBeHidden();
        await expect(page.getByTestId(item)).toHaveCount(rows);
        expect(await controls(page)).toEqual(wide);
        await expect(periodControl(page)).toBeVisible();
      });
    }

    test("Contributions keeps its Remove in the list", async ({ page }) => {
      const path = await fundPath(page, "Pensione Beta");
      await page.setViewportSize({ width: 400, height: 860 });
      await page.goto(`${path}?tab=contributions&period=${Y - 2}`);
      await expect(
        page.getByTestId("operation-line-item").getByRole("button", { name: "Remove" }),
      ).toBeVisible();
    });
  });

  test("the old returns page goes to Valuations, with its period", async ({ page }) => {
    const path = await fundPath(page, "PAC Piano");
    await page.goto(`${path}/returns?period=${Y - 1}`);
    await expect(page).toHaveURL(new RegExp(`${path}\\?tab=valuations&period=${Y - 1}$`));
    await expect(page.getByTestId("fund-valuations")).toBeVisible();
    await page.goto(`${path}/returns?span=60`);
    await expect(page).toHaveURL(new RegExp(`${path}\\?tab=valuations&period=all$`));
    await page.goto(`${path}/returns?from=${Y - 1}-01&to=${Y - 1}-03`);
    await expect(page).toHaveURL(new RegExp(`from=${Y - 1}-01-01&to=${Y - 1}-03-31`));
  });

  test("a value recorded by hand can be edited and deleted from the tab; the dialog speaks the new words", async ({
    page,
  }) => {
    const path = await fundPath(page, "PAC Piano");
    await page.goto(`${path}?tab=valuations&period=all`);
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
    const TABS = {
      "PAC Piano": ["overview", "deposits", "valuations", "settings"],
      "Pensione Beta": ["overview", "contributions", "valuations", "settings"],
    } as const;

    for (const [language, session] of [
      ["en", "fundsDetail"],
      ["it", "fundsCopy"],
    ] as const) {
      test.describe(language, () => {
        test.use({ storageState: sessionState(session) });

        for (const [name, tabs] of Object.entries(TABS)) {
          test(`${name}: no technical word on any tab, nor in the value dialog`, async ({ page }) => {
            const path = await fundPath(page, name);
            for (const tab of tabs) {
              await page.goto(`${path}?tab=${tab}&period=all`);
              await expect(main(page)).toBeVisible();
              const text = await main(page).innerText();
              expect(text, `${tab}: ${text.match(WORDS[language])?.[0]}`).not.toMatch(WORDS[language]);
            }
            await page.goto(`${path}?period=all`);
            await page
              .getByRole("button", { name: language === "en" ? "Record value" : "Registra valore" })
              .first()
              .click();
            const dialog = await page.getByRole("dialog").innerText();
            expect(dialog).not.toMatch(WORDS[language]);
          });
        }

        test("the home has no technical word", async ({ page }) => {
          await page.goto(`${HOME}?period=all`);
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
        for (const name of ["Panoramica", "Contributi", "Valutazioni", "Impostazioni"]) {
          await expect(tabs.getByRole("link", { name })).toBeVisible();
        }
      });
    });
  });
});
