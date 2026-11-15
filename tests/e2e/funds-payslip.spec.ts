// tests/e2e/funds-payslip.spec.ts — the journey of a fund fed by the payslip (spec §7.7, §9.3, §11), with no
// document: since release N6 a fund reads none (docs/design/rewrite-plan/ux/n6-pension-fund.md §2, §5.4,
// §8.1). What the fund says it received is written by hand, and the payslips are the synthetic twins:
// never the owner's own files.
import { expect, type Page, test } from "@playwright/test";
import { APRIL, FEBRUARY, JANUARY, MARCH, THIRTEENTH } from "../fixtures/payroll/samples";
import { twinPdf } from "../fixtures/payroll/twin";
import { sessionState } from "./env";

/** The twins are dated 2031, and a fund's pages read nothing after today: last year, every day of it past. */
const LAST_YEAR = new Date().getFullYear() - 1;
const lastYear = <T>(twin: T): T =>
  JSON.parse(JSON.stringify(twin).replaceAll("2031", String(LAST_YEAR))) as T;

const tab = (page: Page, name: string) =>
  page.getByRole("navigation", { name: "Fund" }).getByRole("link", { name });

test.describe("a fund fed by the payslip", () => {
  test.use({ storageState: sessionState("fundsPayslip") });
  test.describe.configure({ mode: "serial" });
  // Five payslips, each read by the server after its upload: the whole journey does not fit
  // Playwright's thirty seconds, and the step timeouts below are what actually guard each wait
  // (2026-09-20).
  test.setTimeout(180_000);

  /** "Record contribution", from the register of the Contributions tab. */
  async function recordContribution(page: Page) {
    // With no contribution yet the register offers it twice: in its header and in its empty state.
    await page
      .getByTestId("fund-contributions")
      .getByRole("button", { name: "Record contribution" })
      .first()
      .click();
    return page.getByRole("dialog", { name: "Record contribution · Cometa" });
  }

  test("the fund takes the payslips and what is written by hand, and reconciles them", async ({ page }) => {
    let fundUrl = "";

    await test.step("the payslips of a whole year are applied before the fund exists", async () => {
      await page.goto("/payroll");
      for (const twin of [JANUARY, FEBRUARY, MARCH, APRIL, THIRTEENTH].map(lastYear)) {
        await page.getByRole("button", { name: "Add payslip" }).first().click();
        const dialog = page.getByRole("dialog", { name: "Add payslips" });
        await dialog.locator('input[type="file"]').setInputFiles([
          {
            name: `${twin.period}.pdf`,
            mimeType: "application/pdf",
            buffer: Buffer.from(await twinPdf(twin)),
          },
        ]);
        await dialog.getByRole("button", { name: "Upload" }).click();
        await expect(dialog).toBeHidden();
        await expect(page).toHaveURL(/\/payroll\/[0-9a-f-]{36}$/, { timeout: 20_000 });
        await expect(page.getByRole("heading", { level: 1 })).toContainText("To review", { timeout: 20_000 });
        await page.getByRole("button", { name: "Verify", exact: true }).click();
        await page.getByRole("button", { name: "Apply to payroll" }).click();
        await expect(page.getByRole("heading", { level: 1 })).toContainText("Applied", { timeout: 20_000 });
        await page.goto("/payroll");
      }
    });

    await test.step("the fund is created and publishes what the payslips accrued", async () => {
      await page.goto("/funds");
      // One form for every fund (release N6): the payslip is a source chosen in its second step.
      await page.getByRole("link", { name: "Add fund" }).first().click();
      const form = page.getByTestId("fund-wizard");
      await form.getByLabel("Name").fill("Cometa");
      await form.getByLabel("Provider").fill("Cometa");
      await form.getByLabel("Line or compartment").fill("Crescita");
      await form.getByLabel("Member since").fill(`${LAST_YEAR}-01-01`);
      await form.getByRole("button", { name: "Continue" }).click();
      await page.getByTestId("source-switch-payroll").click();
      const sources = page.getByTestId("wizard-step-sources");
      await sources
        .getByRole("group", { name: "Accrual period" })
        .getByRole("button", { name: "Quarter" })
        .click();
      await sources.getByRole("switch", { name: "The transfer has a due date" }).click();
      await sources.getByLabel("Due day").fill("20");
      // No debit and no one-off payment: nothing to fill in for them.
      await expect(sources.getByLabel("Expected amount")).toBeHidden();
      await sources.getByRole("button", { name: "Continue" }).click();
      await page.getByTestId("wizard-step-fees").getByRole("button", { name: "Skip for now" }).click();
      await page.getByTestId("wizard-step-review").getByRole("button", { name: "Create fund" }).click();
      await expect(page).toHaveURL(/\/funds\/[0-9a-f-]{36}$/);
      fundUrl = page.url();
      await expect(page.getByRole("heading", { name: "Cometa", level: 1 })).toBeVisible();
      // 4 × (25,00 + 45,00 + 150,00) + the 13th's 5,00 = 885,00 € accrued, nothing credited yet.
      // The contributions tab has them, with their periods, before the fund has said anything.
      await page.goto(`${fundUrl}?tab=contributions&preset=all`);
      await expect(page.getByTestId("payslip-line")).toHaveCount(5);
      await expect(page.getByTestId("fund-payslips")).toContainText("885,00 €");
      await expect(page.getByTestId("fund-quarters")).toContainText(`Q1 ${LAST_YEAR}`);
      // The first quarter is past its due date with nothing in the fund: it is not reconciled.
      const first = page.getByTestId("quarter-line").filter({ hasText: `Q1 ${LAST_YEAR}` });
      await expect(first).not.toContainText("Reconciled");
      await expect(page.getByTestId("contributions-empty")).toContainText("No contribution yet.");
      await expect(page.getByTestId("contributions-empty")).toContainText(
        "Contributions from the sources arrive automatically.",
      );
    });

    await test.step("a contribution from the payslip, written by hand, reconciles its period", async () => {
      // I: three months, 660,00 gross and 3,00 of fees.
      let dialog = await recordContribution(page);
      // The only source is the payslip: the dialog opens on it.
      await expect(dialog.getByRole("button", { name: "From the payslip" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await dialog.getByLabel("Date").fill(`${LAST_YEAR}-04-18`);
      await dialog.getByLabel("My contribution").fill("75");
      await dialog.getByLabel("Employer").fill("135");
      await dialog.getByLabel("TFR").fill("450");
      await dialog.getByLabel("Period").selectOption({ label: `Q1 ${LAST_YEAR}` });
      await dialog.getByLabel("Fee", { exact: true }).fill("3");
      await expect(dialog.getByTestId("contribution-invested")).toContainText("657,00 €");
      await dialog.getByRole("button", { name: "Save contribution" }).click();
      await expect(dialog).toBeHidden();
      // Component by component, what the payslips accrued is what the fund received: no difference.
      const first = page.getByTestId("quarter-line").filter({ hasText: `Q1 ${LAST_YEAR}` });
      await expect(first).toContainText("accrued 75,00 € · in the fund 75,00 €");
      await expect(first).toContainText("accrued 135,00 € · in the fund 135,00 €");
      await expect(first).toContainText("accrued 450,00 € · in the fund 450,00 €");
      await expect(first).not.toContainText("difference");
      await expect(first).toContainText(`credited 18 Apr ${LAST_YEAR}`);
      const row = page.getByTestId("contribution-row").filter({ hasText: `Q1 ${LAST_YEAR}` });
      await expect(row).toContainText("Payslip");
      await expect(row).toContainText("657,00 €");

      // II: one month, 220,00 gross and 3,00 of fees.
      dialog = await recordContribution(page);
      await dialog.getByLabel("Date").fill(`${LAST_YEAR}-07-18`);
      await dialog.getByLabel("My contribution").fill("25");
      await dialog.getByLabel("Employer").fill("45");
      await dialog.getByLabel("TFR").fill("150");
      await dialog.getByLabel("Period").selectOption({ label: `Q2 ${LAST_YEAR}` });
      await dialog.getByLabel("Fee", { exact: true }).fill("3");
      await dialog.getByRole("button", { name: "Save contribution" }).click();
      await expect(dialog).toBeHidden();

      // The enrolment: 10,32 that the fund kept whole, so nothing of it is invested.
      dialog = await recordContribution(page);
      await dialog.getByRole("button", { name: "Other operation" }).click();
      await dialog.getByLabel("Operation").selectOption({ label: "Enrolment" });
      // Joining names the quarter whose payslips accrued the quota: the two reconcile.
      await dialog.getByLabel("Period").selectOption({ label: `Q1 ${LAST_YEAR}` });
      await dialog.getByLabel("Date").fill(`${LAST_YEAR}-04-18`);
      await dialog.getByLabel("Amount").fill("10,32");
      await dialog.getByLabel("Fee", { exact: true }).fill("10,32");
      await dialog.getByRole("button", { name: "Save contribution" }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByTestId("contribution-row")).toHaveCount(3);
    });

    await test.step("the value is written by hand, with its own date", async () => {
      await page.getByRole("banner").getByRole("button", { name: "Update value" }).click();
      const dialog = page.getByRole("dialog", { name: "Update value · Cometa" });
      await dialog.getByLabel("Date of the value").fill(`${LAST_YEAR}-08-31`);
      await dialog.getByLabel("Value (€)").fill("950");
      await dialog.getByRole("button", { name: "Save value" }).click();
      await expect(dialog).toBeHidden();
    });

    await test.step("the six quantities are shown apart, and the panel reconciles them", async () => {
      await page.goto(`${fundUrl}?off=1`);
      // Value 950,00 · paid in 890,32 · gain +59,68.
      await expect(page.getByTestId("fund-value")).toContainText("950,00 €");
      await expect(page.getByTestId("kpi-paid")).toContainText("890,32 €");
      await expect(page.getByTestId("funds-hero")).toContainText("+59,68 €");
      const bridge = page.getByTestId("fund-bridge");
      await expect(bridge).toContainText("Accrued in payslips");
      await expect(bridge).toContainText("885,00 €");
      await expect(bridge).toContainText("890,32 €");
      await expect(bridge).toContainText("874,00 €");
    });

    await test.step("the periods carry what was credited, and the months their state", async () => {
      await tab(page, "Contributions").click();
      await expect(page.getByTestId("payslip-line")).toHaveCount(5);
      const quarters = page.getByTestId("fund-quarters");
      await expect(quarters).toContainText(`Q1 ${LAST_YEAR}`);
      await expect(quarters).toContainText(`Q2 ${LAST_YEAR}`);
      await expect(page.getByTestId("quarter-line").filter({ hasText: `Q2 ${LAST_YEAR}` })).toContainText(
        "accrued 150,00 € · in the fund 150,00 €",
      );
    });

    await test.step("no document anywhere: nothing to import, no list, no statement, no address", async () => {
      await tab(page, "Values").click();
      await expect(page.getByTestId("valuation-line")).toHaveCount(1);
      // Nothing was ever read from a document for this fund: the block of the old statements is not there.
      await expect(page.getByTestId("fund-statements")).toHaveCount(0);
      await expect(page.getByTestId("fund-documents")).toHaveCount(0);
      await expect(page.getByTestId("fund-document")).toHaveCount(0);
      for (const name of ["Overview", "Contributions", "Values", "Settings"]) {
        await tab(page, name).click();
        await expect(tab(page, name)).toHaveAttribute("aria-current", "page");
        await expect(page.getByRole("button", { name: /Import/ }), name).toHaveCount(0);
        await expect(page.locator('input[type="file"]'), name).toHaveCount(0);
        await expect(page.locator('a[href*="/documents/"]'), name).toHaveCount(0);
      }
      const path = new URL(fundUrl).pathname;
      for (const address of [`${path}/documents/anything`, `${path}/documents/${path.split("/").pop()}`]) {
        expect((await page.request.get(address, { maxRedirects: 0 })).status(), address).toBe(404);
      }
    });

    await test.step("the list shows the fund", async () => {
      await page.goto(`/funds?off=1`);
      const row = page.getByTestId("fund-home-row").filter({ hasText: "Cometa" });
      await expect(row).toContainText("950,00 €");
      await expect(row).toContainText("890,32 €");
    });
  });

  test("the fund reads at 400 px", async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 900 });
    await page.goto(`/funds?off=1`);
    const item = page.getByTestId("fund-home-item").filter({ hasText: "Cometa" });
    await expect(item).toBeVisible();
    await item.getByRole("link", { name: "Cometa" }).click();
    await expect(page.getByRole("heading", { name: "Cometa", level: 1 })).toBeVisible();
    await expect(page.getByText("950,00 €").first()).toBeVisible();
    await expect(page.getByTestId("fund-bridge")).toBeVisible();
    // Nothing overflows the phone's width.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  // The assertion of the journey of before N6 ("the quarters reconcile"): January's payslip accrues
  // the enrolment quota in the first quarter, and the enrolment written by hand names that quarter.
  test("the quarter with the enrolment quota reconciles", async ({ page }) => {
    await page.goto(`/funds?off=1`);
    await page
      .getByTestId("fund-home-row")
      .filter({ hasText: "Cometa" })
      .getByRole("link", { name: "Cometa" })
      .click();
    await tab(page, "Contributions").click();
    const first = page.getByTestId("quarter-line").filter({ hasText: `Q1 ${LAST_YEAR}` });
    await expect(first).toBeVisible();
    await expect(first).toContainText("Reconciled");
  });
});

test.describe("a quarter the payslips accrued, with no enrolment quota", () => {
  // "Fondo Busta" of the `fundsSetup` seed: three payslips of last year's first quarter, 360,00 +
  // 540,00 + 900,00 €, and nothing from the fund yet.
  test.use({ storageState: sessionState("fundsSetup") });

  test("a contribution from the payslip, written by hand, reconciles the period", async ({ page }) => {
    await page.goto("/funds?preset=all");
    const href = await page
      .getByTestId("fund-home-row")
      .filter({ hasText: "Fondo Busta" })
      .getByRole("link", { name: "Fondo Busta" })
      .getAttribute("href");
    await page.goto(`${href!.split("?")[0]}?tab=contributions&preset=all`);
    const quarter = page.getByTestId("quarter-line").filter({ hasText: `Q1 ${LAST_YEAR}` });
    await expect(quarter).toContainText("accrued 360,00 € · in the fund —");
    await expect(quarter).not.toContainText("Reconciled");

    await page
      .getByTestId("fund-contributions")
      .getByRole("button", { name: "Record contribution" })
      .first()
      .click();
    const dialog = page.getByRole("dialog", { name: "Record contribution · Fondo Busta" });
    await expect(dialog.getByRole("button", { name: "From the payslip" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await dialog.getByLabel("Date").fill(`${LAST_YEAR}-04-18`);
    await dialog.getByLabel("Period").selectOption({ label: `Q1 ${LAST_YEAR}` });
    // One component short of what the payslips say: the period shows the difference, and offers to accept it.
    await dialog.getByLabel("My contribution").fill("350");
    await dialog.getByLabel("Employer").fill("540");
    await dialog.getByLabel("TFR").fill("900");
    await dialog.getByLabel("Fee", { exact: true }).fill("3");
    await dialog.getByRole("button", { name: "Save contribution" }).click();
    await expect(dialog).toBeHidden();
    await expect(quarter).toContainText("accrued 360,00 € · in the fund 350,00 €");
    await expect(quarter).toContainText("difference −10,00 €");
    await expect(quarter).not.toContainText("Reconciled");

    // Corrected to what the fund really received: the three components agree, and the period reconciles.
    await page
      .getByRole("button", { name: /^Edit the contribution of 18 Apr/ })
      .filter({ visible: true })
      .click();
    const edit = page.getByRole("dialog", { name: "Edit contribution" });
    await expect(edit.getByLabel("My contribution")).toHaveValue("350,00");
    await edit.getByLabel("My contribution").fill("360");
    await edit.getByRole("button", { name: "Save contribution" }).click();
    await expect(edit).toBeHidden();
    await expect(quarter).toContainText("Reconciled");
    await expect(quarter).toContainText("accrued 360,00 € · in the fund 360,00 €");
    await expect(quarter).toContainText("accrued 540,00 € · in the fund 540,00 €");
    await expect(quarter).toContainText("accrued 900,00 € · in the fund 900,00 €");
    await expect(quarter).not.toContainText("difference");
    // The row is the payslip source's, with its period, and it can be edited and deleted by hand.
    const row = page.getByTestId("contribution-row").filter({ hasText: `Q1 ${LAST_YEAR}` });
    await expect(row).toContainText("Payslip");
    await expect(row).toContainText("1.797,00 €");
    await expect(row.getByRole("button", { name: /^Delete the contribution of/ })).toBeVisible();
  });
});

test.describe("what a document left before release N6", () => {
  // The "Cometa" of the `layout` seed: the operations and the position its two documents wrote.
  test.use({ storageState: sessionState("layout") });

  test("the statements already read are read only, with no link to a file", async ({ page }) => {
    await page.goto(`/funds?off=1`);
    const href = await page
      .getByTestId("fund-home-row")
      .filter({ hasText: "Cometa" })
      .getByRole("link", { name: "Cometa" })
      .getAttribute("href");
    const path = href!.split("?")[0];

    await page.goto(`${path}?tab=valuations&preset=all`);
    const statements = page.getByTestId("fund-statements");
    await expect(statements.getByRole("heading", { name: "Statements already read" })).toBeVisible();
    await expect(statements).toContainText(
      "Data read from documents before the import was removed. It stays part of the fund.",
    );
    await expect(page.getByTestId("statement-line")).toHaveCount(1);
    await expect(page.getByTestId("statement-line")).toContainText("950,00 €");
    // Read only: no link, to a file or anywhere, and no command.
    await expect(statements.getByRole("link")).toHaveCount(0);
    await expect(statements.getByRole("button")).toHaveCount(0);
    await expect(statements).not.toContainText(".pdf");
    // No list of documents and nothing to import: a new value enters with "Update value" alone.
    await expect(page.getByTestId("fund-documents")).toHaveCount(0);
    await expect(page.getByTestId("fund-document")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Import/ })).toHaveCount(0);
    await expect(page.locator('a[href*="/documents/"]')).toHaveCount(0);
    await expect(page.getByRole("banner").getByRole("button", { name: "Update value" })).toBeVisible();

    // The rows the export left are in the register as history: "Imported", with no action.
    await page.goto(`${path}?tab=contributions&preset=all`);
    const imported = page.getByTestId("contribution-row").filter({ hasText: "Imported" });
    await expect(imported).toHaveCount(3);
    await expect(imported.getByRole("button")).toHaveCount(0);
  });
});
