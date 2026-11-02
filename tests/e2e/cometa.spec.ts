// tests/e2e/cometa.spec.ts — the F6 pension journey (spec §7.7, §9.3, §11), on the synthetic twins
// of the Cometa documents and of the payslips: never the owner's own files.
import { expect, type Page, test } from "@playwright/test";
import { EXPORT_AUGUST, inYear, POSITION_AUGUST } from "../fixtures/cometa/samples";
import { twinOperationsHtml, twinPositionPdf } from "../fixtures/cometa/twin";
import { APRIL, FEBRUARY, JANUARY, MARCH, THIRTEENTH } from "../fixtures/payroll/samples";
import { twinPdf } from "../fixtures/payroll/twin";
import { sessionState } from "./env";

test.use({ storageState: sessionState("cometa") });
test.describe.configure({ mode: "serial" });
// Twelve payslips, an operations export and a statement, each read by the server after its upload:
// the whole journey does not fit Playwright's thirty seconds, and the step timeouts below are what
// actually guard each wait (2026-09-20).
test.setTimeout(180_000);

async function importDocuments(page: Page, files: { name: string; mimeType: string; buffer: Buffer }[]) {
  await page.getByRole("button", { name: "Import documents" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Import Cometa documents" });
  await dialog.locator('input[type="file"]').setInputFiles(files);
  await dialog.getByRole("button", { name: "Upload" }).click();
  await expect(dialog).toBeHidden();
}

/** The twins are dated 2031, and a fund's pages read nothing after today: last year, every day of it past. */
const LAST_YEAR = new Date().getFullYear() - 1;
const lastYear = <T>(twin: T): T => inYear(twin, LAST_YEAR);

const tab = (page: Page, name: string) =>
  page.getByRole("navigation", { name: "Fund" }).getByRole("link", { name });

test("a pension fund takes the payslips, the export and the statement, and reconciles them", async ({
  page,
}) => {
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
    // One "Add fund" for both kinds: the kind is chosen in the dialog (design "Fund kind"), and
    // choosing the pension fund leaves only who runs it and since when.
    await page.getByRole("button", { name: "Add fund" }).first().click();
    const dialog = page.getByRole("dialog", { name: "New fund" });
    await dialog.getByRole("button", { name: "Pension fund" }).click();
    await expect(dialog.getByLabel("Monthly amount debited (€)")).toBeHidden();
    await dialog.getByLabel("Name").fill("Cometa");
    await dialog.getByLabel("Provider").fill("Cometa");
    await dialog.getByLabel("Type / compartment").fill("Crescita");
    await dialog.getByLabel("Member since").fill(`${LAST_YEAR}-01-01`);
    await dialog.getByRole("button", { name: "Save fund" }).click();
    await expect(page).toHaveURL(/\/funds\/[0-9a-f-]{36}$/);
    fundUrl = page.url();
    await expect(page.getByRole("heading", { name: "Cometa", level: 1 })).toBeVisible();
    // 4 × (25,00 + 45,00 + 150,00) + the 13th's 5,00 = 885,00 € accrued, nothing credited yet.
    // The contributions tab has them, with their quarters, before the fund has said anything.
    await page.goto(`${fundUrl}?tab=contributions&period=all`);
    await expect(page.getByTestId("payslip-line")).toHaveCount(5);
    await expect(page.getByTestId("fund-payslips")).toContainText("885,00 €");
    await expect(page.getByTestId("fund-quarters")).toContainText(`I ${LAST_YEAR}`);
  });

  await test.step("the export is reviewed operation by operation, then applied", async () => {
    await importDocuments(page, [
      {
        name: "DettaglioOperazioni.xls",
        mimeType: "application/vnd.ms-excel",
        buffer: Buffer.from(twinOperationsHtml(EXPORT_AUGUST.map(lastYear))),
      },
    ]);
    await expect(page).toHaveURL(/\/funds\/[0-9a-f-]{36}\/documents\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Operations export", {
      timeout: 20_000,
    });
    const rows = page.getByTestId("preview-row");
    await expect(rows).toHaveCount(3, { timeout: 20_000 });
    await expect(rows.filter({ hasText: "New" })).toHaveCount(3);
    await expect(rows.filter({ hasText: "Enrolment" })).toHaveCount(1);
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page).toHaveURL(/\/funds\/[0-9a-f-]{36}\?tab=valuations$/, { timeout: 20_000 });
    await page.goto(`${fundUrl}?tab=contributions&period=all`);
    await expect(page.getByTestId("operation-line")).toHaveCount(3);
  });

  await test.step("the statement gives the value, with its own date and its box on the page", async () => {
    await importDocuments(page, [
      {
        name: "riepilogo_posizione.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(await twinPositionPdf(lastYear(POSITION_AUGUST))),
      },
    ]);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Position summary", {
      timeout: 20_000,
    });
    await expect(page.getByText("950,00 €").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("pdf-canvas")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Position value" }).click();
    await expect(page.getByTestId("pdf-highlight")).toHaveCount(1);
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page).toHaveURL(/\/funds\/[0-9a-f-]{36}\?tab=valuations$/, { timeout: 20_000 });
  });

  await test.step("the six quantities are shown apart, and the panel reconciles them", async () => {
    await page.goto(`${fundUrl}?period=${LAST_YEAR}`);
    // Value 950,00 · paid in 890,32 · gain +59,68.
    await expect(page.getByTestId("fund-value")).toContainText("950,00 €");
    await expect(page.getByTestId("kpi-paid")).toContainText("890,32 €");
    await expect(page.getByTestId("funds-hero")).toContainText("+59,68 €");
    // The enrolment fee is in the money paid in, and not in the deductible: 100,00 + 180,00.
    await expect(page.getByTestId("kpi-deductible")).toContainText("280,00 €");
    const bridge = page.getByTestId("fund-bridge");
    await expect(bridge).toContainText("Accrued in payslips");
    await expect(bridge).toContainText("885,00 €");
    await expect(bridge).toContainText("890,32 €");
    await expect(bridge).toContainText("874,00 €");
  });

  await test.step("the quarters reconcile, and the months carry their state", async () => {
    await tab(page, "Contributions").click();
    await expect(page.getByTestId("payslip-line")).toHaveCount(5);
    const quarters = page.getByTestId("fund-quarters");
    await expect(quarters).toContainText(`I ${LAST_YEAR}`);
    await expect(quarters).toContainText("Reconciled");
    // The same deductible as the KPI: the table and the KPI read the same flows.
    await expect(page.getByTestId("deductible-line")).toHaveAttribute("data-cents", "28000");
  });

  await test.step("the statement and the documents are listed, and the list shows the fund", async () => {
    await tab(page, "Valuations").click();
    await expect(page.getByTestId("statement-line")).toHaveCount(1);
    await expect(page.getByTestId("fund-document")).toHaveCount(2);
    await page.goto(`/funds?period=${LAST_YEAR}`);
    const row = page.getByTestId("fund-home-row").filter({ hasText: "Cometa" });
    await expect(row).toContainText("950,00 €");
    await expect(row).toContainText("890,32 €");
  });
});

test("the pension fund reads at 400 px", async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 900 });
  await page.goto(`/funds?period=${LAST_YEAR}`);
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
