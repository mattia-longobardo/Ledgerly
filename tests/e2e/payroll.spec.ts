// tests/e2e/payroll.spec.ts — the F5 payslip journey (spec §7.8, §9.3, §11), on the synthetic twin
// of a Reply/TeamSystem payslip: never a real one.
import { expect, type Page, test } from "@playwright/test";
import { MARCH } from "../fixtures/payroll/samples";
import { twinPdf } from "../fixtures/payroll/twin";
import { sessionState } from "./env";

test.use({ storageState: sessionState("payroll") });
test.describe.configure({ mode: "serial" });

async function upload(page: Page, files: { name: string; mimeType: string; buffer: Buffer }[]) {
  await page.getByRole("button", { name: "Add payslip" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add payslips" });
  await dialog.locator('input[type="file"]').setInputFiles(files);
  await dialog.getByRole("button", { name: "Upload" }).click();
  await expect(dialog).toBeHidden();
}

const field = (page: Page, name: string) => page.locator(`li[data-field="${name}"]`);
const toast = (page: Page, text: string) =>
  page.getByRole("region", { name: "Notifications" }).getByText(text).first();

test("a payslip is uploaded, read, reviewed against its PDF, verified and applied", async ({ page }) => {
  const pdf = {
    name: "busta-marzo-2031.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await twinPdf(MARCH)),
  };
  let reviewUrl = "";

  await test.step("the empty register offers to add one", async () => {
    await page.goto("/payroll");
    await expect(page.getByRole("heading", { name: "No payslips yet" })).toBeVisible();
  });

  await test.step("the upload opens its review, which follows the reading", async () => {
    await upload(page, [pdf]);
    await expect(page).toHaveURL(/\/payroll\/[0-9a-f-]{36}$/);
    reviewUrl = page.url();
    await expect(page.getByRole("heading", { name: /MARZO 2031/, level: 1 })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("heading", { level: 1 })).toContainText("To review");
    await expect(page.locator('[data-check="net"]')).toContainText("Passed");
    await expect(page.locator('[data-check="irpef"]')).toContainText("Passed");
    await expect(field(page, "netPay")).toContainText("1.511,00 €");
    await expect(field(page, "gross")).toContainText("Derived");
  });

  await test.step("choosing a value draws its box on the document", async () => {
    await expect(page.getByTestId("pdf-canvas")).toBeVisible({ timeout: 20_000 });
    await field(page, "netPay").getByRole("button", { name: "Net pay" }).click();
    await expect(page.getByTestId("pdf-highlight")).toHaveCount(1);
  });

  await test.step("going back to the register from the review, in the app, works", async () => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.getByRole("link", { name: "Payroll" }).first().click();
    await expect(page).toHaveURL(/\/payroll$/);
    await expect(page.getByRole("heading", { name: "Payroll", level: 1 })).toBeAttached();
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
    expect(errors).toEqual([]);
    await page.goto(reviewUrl);
    await expect(page.getByTestId("pdf-canvas")).toBeVisible({ timeout: 20_000 });
  });

  await test.step("a correction keeps the original and fails the net check until undone", async () => {
    await field(page, "netPay").getByRole("button", { name: "Correct" }).click();
    await field(page, "netPay").getByRole("textbox", { name: "Net pay" }).fill("1512,00");
    await field(page, "netPay").getByRole("button", { name: "Save" }).click();
    await expect(field(page, "netPay")).toContainText("Read as 1.511,00 €");
    await expect(page.locator('[data-check="net"]')).toContainText("Failed");
    await page.getByRole("button", { name: "Verify", exact: true }).click();
    const confirm = page.getByRole("dialog", { name: "Some checks failed" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Cancel" }).click();

    await field(page, "netPay").getByRole("button", { name: "Correct" }).click();
    await field(page, "netPay").getByRole("textbox", { name: "Net pay" }).fill("1511,00");
    await field(page, "netPay").getByRole("button", { name: "Save" }).click();
    await expect(page.locator('[data-check="net"]')).toContainText("Passed");
    await expect(field(page, "netPay")).toContainText("Confirmed");
  });

  await test.step("verified, then applied, with its leave in the month it was used", async () => {
    await page.getByRole("button", { name: "Verify", exact: true }).click();
    await expect(page.getByTestId("review-banner")).toContainText("Verified");
    await page.getByRole("button", { name: "Apply to payroll" }).click();
    await expect(page.getByTestId("review-banner")).toContainText("Applied to the register");
    await expect(page.getByTestId("leave-events")).toContainText("8,00 h of holiday used in February 2031");
  });

  await test.step("the register shows it by year, with totals, averages and details", async () => {
    await page.goto("/payroll");
    await expect(page.getByText("1 payslip · Mar 31 – Mar 31")).toBeVisible();
    const table = page.getByRole("table");
    await expect(table.getByRole("rowheader", { name: "March 2031" })).toBeVisible();
    await expect(table.getByRole("row", { name: /Total 2031/ })).toContainText("1.511,00 €");
    await expect(page.getByText("Avg net · 3 months").locator("..")).toContainText("1.511,00 €");
    await page.getByRole("button", { name: "Show details" }).click();
    await expect(table.getByRole("row", { name: /March 2031/ })).toContainText("45,00 h");
  });

  await test.step("the same file again is the same payslip, and a non-PDF is refused", async () => {
    await upload(page, [pdf]);
    await expect(page).toHaveURL(reviewUrl);
    await expect(toast(page, "1 was already imported")).toBeVisible();
    await page.goto("/payroll");
    await upload(page, [
      { name: "fake.pdf", mimeType: "application/pdf", buffer: Buffer.from("not a pdf at all") },
    ]);
    await expect(toast(page, "fake.pdf: not a PDF")).toBeVisible();
  });

  await test.step("the original is served to its owner only, inline and never cached", async () => {
    const response = await page.request.get(`${reviewUrl}/original`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("application/pdf");
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect((await page.request.get("/payroll/00000000-0000-7000-8000-000000000000/original")).status()).toBe(
      404,
    );
  });

  await test.step("the code map is in Settings › Data, and a code's meaning can change", async () => {
    await page.goto("/settings/data");
    const row = page.locator('li[data-code="9424"]');
    await expect(row).toBeVisible();
    await row.getByRole("combobox").selectOption({ label: "Separate payment" });
    await row.getByRole("button", { name: "Save" }).click();
    await expect(toast(page, "Code map saved")).toBeVisible();
    await row.getByRole("button", { name: "Reset" }).click();
    await expect(row.getByRole("combobox")).toHaveValue("statistical");
  });

  await test.step("the OpenAI fallback's settings are an admin's only", async () => {
    await expect(page.getByRole("link", { name: "Server" })).toHaveCount(0);
    const response = await page.goto("/settings/server");
    expect(response?.status()).toBe(404);
  });
});

test.describe("at 400 px", () => {
  test.use({ viewport: { width: 400, height: 860 } });

  test("the register is a list, and a payslip opens from it", async ({ page }) => {
    await page.goto("/payroll");
    const item = page.getByRole("link", { name: /March 2031/ });
    await expect(item).toBeVisible();
    await expect(item).toContainText("1.511,00 €");
    await item.click();
    await expect(page.getByRole("heading", { name: /MARZO 2031/, level: 1 })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
