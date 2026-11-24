// tests/e2e/payroll/manual.spec.ts — R5g, criterion 3: a person with no country, no reading profile and
// no payslip uses Payroll by typing payslips by hand, and says how the employer pays. Invented amounts.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { sessionState } from "../_shared/env";
import { hydrated } from "../_shared/helpers";

test.use({ storageState: sessionState("payrollManual") });
test.describe.configure({ mode: "serial" });

// A year of its own: the journey writes nothing else, so its rows are the only ones.
const YEAR = "2030";

const toast = (page: Page, text: string) =>
  page.getByRole("region", { name: "Notifications" }).getByText(text).first();

async function fill(dialog: Locator, values: { kind?: string; when?: string; net?: string }) {
  if (values.kind) await dialog.getByLabel("Kind", { exact: true }).selectOption({ label: values.kind });
  await dialog.getByLabel("Year", { exact: true }).fill(YEAR);
  if (values.when) await dialog.getByLabel(/^(Month|Which extra payment)$/).selectOption({ label: values.when });
  await dialog.getByLabel("Gross", { exact: true }).fill("3000,00");
  await dialog.getByLabel("Taxes", { exact: true }).fill("600,00");
  await dialog.getByLabel("Social contributions", { exact: true }).fill("280,00");
  await dialog.getByLabel("Net", { exact: true }).fill(values.net ?? "2120,00");
}

async function typePayslip(page: Page, values: { kind?: string; when?: string; net?: string }) {
  const open = page.getByRole("button", { name: "Type a payslip" }).first();
  await hydrated(open);
  await open.click();
  const dialog = page.getByRole("dialog", { name: "Type a payslip" });
  await fill(dialog, values);
  await dialog.getByRole("button", { name: "Save payslip" }).click();
  return dialog;
}

test("a payslip typed by hand is applied at once, opened, changed and deleted", async ({ page }) => {
  const table = page.getByRole("table");

  await test.step("the empty register offers to type one, and has no details to show", async () => {
    await page.goto("/payroll");
    await expect(page.getByRole("heading", { name: "No payslips yet" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Type a payslip" })).toHaveCount(2);
  });

  await test.step("an ordinary payslip enters the register at once, typed by hand", async () => {
    const dialog = await typePayslip(page, { when: "March" });
    await expect(dialog).toBeHidden();
    await expect(toast(page, "Payslip saved")).toBeVisible();
    const row = table.getByRole("row", { name: /March 2030/ });
    await expect(row).toContainText("Typed by hand");
    await expect(row).toContainText("2.120,00 €");
    await expect(row).toContainText("Applied");
    await expect(page.getByRole("button", { name: "Show details" })).toHaveCount(0);
  });

  await test.step("the same month twice is refused in words", async () => {
    const dialog = await typePayslip(page, { when: "March" });
    await expect(dialog.getByRole("alert")).toHaveText("This month already has a payslip in the register.");
    await dialog.getByRole("button", { name: "Cancel" }).click();
  });

  await test.step("an extra payment has its number and no month", async () => {
    const dialog = await typePayslip(page, { kind: "Extra payment", when: "13th", net: "2000,00" });
    await expect(dialog).toBeHidden();
    await expect(table.getByRole("row", { name: /13th/ })).toContainText("2.000,00 €");
    await expect(table.getByRole("row", { name: /Total 2030/ })).toContainText("4.120,00 €");
  });

  await test.step("the payslip opens its own page, never a review of a document it does not have", async () => {
    await table.getByRole("row", { name: /March 2030/ }).getByRole("link", { name: "Open" }).click();
    await expect(page).toHaveURL(/\/payroll\/manual\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: /March 2030/, level: 1 })).toContainText("Typed by hand");
    await expect(page.getByText("No PDF")).toBeVisible();
  });

  await test.step("a change is saved and shown", async () => {
    const edit = page.getByRole("button", { name: "Edit" });
    await hydrated(edit);
    await edit.click();
    const dialog = page.getByRole("dialog", { name: "Edit payslip" });
    await expect(dialog.getByLabel("Net", { exact: true })).toHaveValue("2120,00");
    await dialog.getByLabel("Net", { exact: true }).fill("2100,00");
    await dialog.getByRole("button", { name: "Save payslip" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("2.100,00 €")).toBeVisible();
  });

  await test.step("deleted, it leaves the register", async () => {
    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("dialog", { name: "Delete this payslip?" }).getByRole("button", { name: "Delete" }).click();
    await expect(page).toHaveURL(/\/payroll$/);
    await expect(toast(page, "Payslip deleted")).toBeVisible();
    await expect(table.getByRole("row", { name: /March 2030/ })).toHaveCount(0);
    await expect(table.getByRole("row", { name: /13th/ })).toBeVisible();
  });
});

test("the employer's extra payments are saved", async ({ page }) => {
  await page.goto("/payroll/settings");
  const employer = page.getByTestId("employer");
  await expect(employer).toContainText("Not set yet");
  const extras = employer.getByLabel("Extra payments");
  await hydrated(extras);
  await extras.selectOption("2");
  await expect(employer.getByLabel("Month of the 13th")).toHaveValue("12");
  await employer.getByLabel("Month of the 14th").selectOption({ label: "July" });
  await employer.getByLabel("Pay frequency").selectOption({ label: "Twice a month" });
  await employer.getByRole("button", { name: "Save" }).click();
  await expect(toast(page, "Employer saved")).toBeVisible();

  await page.reload();
  await expect(employer.getByLabel("Month of the 14th")).toHaveValue("7");
  await expect(employer.getByLabel("Pay frequency")).toHaveValue("semimonthly");
  await expect(employer).not.toContainText("Not set yet");
});
