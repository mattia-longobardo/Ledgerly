// tests/e2e/funds-new.spec.ts — the form "Add pension fund" (release N6,
// docs/design/rewrite-plan/ux/n6-pension-fund.md §3, §16.3): four steps on a page of their own, no fund
// kind, nothing written before "Create fund".
import { expect, type Page, test } from "@playwright/test";
import { sessionState } from "./env";

const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(new Date());
const Y = Number(TODAY.slice(0, 4));

const form = (page: Page) => page.getByTestId("fund-wizard");
const step = (page: Page, name: "fund" | "sources" | "fees" | "review") =>
  page.getByTestId(`wizard-step-${name}`);

/** Presses Tab until the focus is on `target`, at most `limit` times. */
async function tabTo(page: Page, target: ReturnType<Page["locator"]>, limit = 40): Promise<void> {
  for (let index = 0; index < limit; index += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => element === document.activeElement).catch(() => false)) return;
  }
  throw new Error(`Tab never reached ${String(target)}`);
}

test.describe("the form", () => {
  // Its own user: an account and no fund (scripts/seed-e2e.ts), so the payslip is free.
  test.use({ storageState: sessionState("fundsNew") });

  test("the four steps are walked with the keyboard only, and the fund is created", async ({ page }) => {
    await page.goto("/funds/new");
    await expect(step(page, "fund")).toBeVisible();
    const steps = page.getByRole("list", { name: "Steps" });
    await expect(steps.locator('[aria-current="step"]')).toContainText("The fund");

    // Step 1. Enter inside a field sends the step, and what is missing takes the focus.
    await tabTo(page, form(page).getByLabel("Name"));
    await page.keyboard.press("Enter");
    await expect(step(page, "fund")).toContainText("Enter a name.");
    await expect(form(page).getByLabel("Name")).toBeFocused();
    await expect(form(page).getByLabel("Name")).toHaveAttribute("aria-invalid", "true");
    await page.keyboard.type("Fondo Tastiera");
    await tabTo(page, form(page).getByLabel("Member since"));
    // A date field takes its three parts in the order of the locale: month, day, year.
    await page.keyboard.type(`0301${Y - 1}`);
    await expect(form(page).getByLabel("Member since")).toHaveValue(`${Y - 1}-03-01`);
    await page.keyboard.press("Enter");

    // Step 2. The focus is on the step's heading; Space switches a source on and keeps the focus.
    await expect(page).toHaveURL(/\/funds\/new\?step=sources$/);
    await expect(page.getByRole("heading", { name: "How you pay in", level: 2 })).toBeFocused();
    await expect(steps.locator('[aria-current="step"]')).toContainText("How you pay in");
    await expect(steps.getByRole("link", { name: /The fund/ })).toContainText("done");
    const manual = page.getByTestId("source-switch-manual");
    await tabTo(page, manual);
    await page.keyboard.press("Space");
    await expect(manual).toHaveAttribute("aria-checked", "true");
    await expect(manual).toBeFocused();
    // Escape does nothing in the form: it is left with "Cancel" or with the link to Funds.
    await page.keyboard.press("Escape");
    await expect(step(page, "sources")).toBeVisible();
    await tabTo(page, step(page, "sources").getByRole("button", { name: "Continue" }));
    await page.keyboard.press("Enter");

    // Step 3. No fee: the primary button says so.
    await expect(page).toHaveURL(/step=fees$/);
    await expect(page.getByRole("heading", { name: "Fees", level: 2 })).toBeFocused();
    await tabTo(page, step(page, "fees").getByRole("button", { name: "Skip for now" }));
    await page.keyboard.press("Enter");

    // Step 4. The summary, then the fund.
    await expect(page).toHaveURL(/step=review$/);
    await expect(page.getByRole("heading", { name: "Summary", level: 2 })).toBeFocused();
    await expect(step(page, "review")).toContainText("Fondo Tastiera");
    await expect(step(page, "review")).toContainText("One-off payments");
    await tabTo(page, step(page, "review").getByRole("button", { name: "Create fund" }));
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/funds\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "Fondo Tastiera", level: 1 })).toBeVisible();
    await expect(page.getByText("Fund created")).toBeVisible();
    // "One-off payments" puts "Record contribution" at the top of the fund's page.
    await expect(page.getByRole("banner").getByRole("button", { name: "Record contribution" })).toBeVisible();
  });

  test("with the first step alone the fund is created and its page opens", async ({ page }) => {
    await page.goto("/funds");
    await page.getByRole("link", { name: "Add fund" }).first().click();
    await expect(page).toHaveURL(/\/funds\/new$/);
    // No dialog and no fund kind any more.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(form(page).getByRole("button", { name: /PAC|Pension fund|Accumulation/ })).toHaveCount(0);

    await form(page).getByLabel("Name").fill("Fondo Minimo");
    await form(page)
      .getByLabel("Member since")
      .fill(`${Y - 1}-03-01`);
    await form(page).getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/step=sources$/);
    // The browser's Back goes to the step before, and what was written is still there.
    await page.goBack();
    await expect(form(page).getByLabel("Name")).toHaveValue("Fondo Minimo");
    await form(page).getByRole("button", { name: "Continue" }).click();
    await step(page, "sources").getByRole("button", { name: "Continue" }).click();
    await expect(step(page, "fees")).toContainText("No fees. You can add them later, in the settings.");
    await step(page, "fees").getByRole("button", { name: "Skip for now" }).click();

    const review = step(page, "review");
    await expect(review).toContainText("No source: you record contributions and values by hand.");
    await expect(review).toContainText("No fees.");
    await review.getByRole("button", { name: "Create fund" }).click();

    await expect(page).toHaveURL(/\/funds\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "Fondo Minimo", level: 1 })).toBeVisible();
    // A fund just created: its two first steps, and nothing a source would add.
    await expect(page.getByTestId("fund-first-steps")).toBeVisible();
    await expect(page.getByTestId("kpi-debit")).toHaveCount(0);
    await expect(page.getByTestId("fund-on-the-way")).toHaveCount(0);
    await page.goto(`${page.url()}?tab=settings`);
    await expect(page.getByTestId("fund-sources")).toContainText("No source");
    await expect(page.getByTestId("fund-fees")).toContainText("Fees not set");
  });

  test("a second fund with the same name is refused on the first step", async ({ page }) => {
    await page.goto("/funds/new");
    await form(page).getByLabel("Name").fill("Fondo Minimo");
    await form(page)
      .getByLabel("Member since")
      .fill(`${Y - 1}-03-01`);
    await form(page).getByRole("button", { name: "Continue" }).click();
    await step(page, "sources").getByRole("button", { name: "Continue" }).click();
    await step(page, "fees").getByRole("button", { name: "Skip for now" }).click();
    await step(page, "review").getByRole("button", { name: "Create fund" }).click();
    // Back on step 1, under the name, with the focus on it.
    await expect(page).toHaveURL(/\/funds\/new(\?step=fund)?$/);
    await expect(step(page, "fund")).toContainText("A fund with that name already exists.");
    await expect(form(page).getByLabel("Name")).toBeFocused();
  });

  test("an address past the first step, with nothing written, goes back to it", async ({ page }) => {
    await page.goto("/funds/new?step=review");
    await expect(page).toHaveURL(/\/funds\/new\?step=fund$/);
    await expect(step(page, "fund")).toBeVisible();
    await expect(step(page, "review")).toBeHidden();
  });

  test("with the three sources and two fees the summary has a line per choice, and the fund shows them", async ({
    page,
  }) => {
    await page.goto("/funds/new");
    await form(page).getByLabel("Name").fill("Fondo Completo");
    await form(page).getByLabel("Provider").fill("Esempio Previdenza");
    await form(page).getByLabel("Line or compartment").fill("Bilanciata");
    await form(page)
      .getByLabel("Member since")
      .fill(`${Y - 1}-03-01`);
    await form(page).getByLabel("Value today").fill("1200");
    await expect(form(page).getByLabel("Date of the value")).toHaveValue(TODAY);
    await form(page).getByRole("button", { name: "Continue" }).click();

    const sources = step(page, "sources");
    // The payslip: the three components, by quarter, due on the 20th of the month after.
    await page.getByTestId("source-switch-payroll").click();
    for (const component of ["My contribution", "Employer", "TFR"]) {
      await expect(sources.getByRole("checkbox", { name: component })).toBeChecked();
    }
    await sources
      .getByRole("group", { name: "Accrual period" })
      .getByRole("button", { name: "Quarter" })
      .click();
    await sources.getByRole("switch", { name: "The transfer has a due date" }).click();
    await sources.getByLabel("Due day").fill("20");
    await expect(page.getByTestId("due-preview")).toContainText(
      "Next due dates: 20 Jan · 20 Apr · 20 Jul · 20 Oct",
    );
    // The debit: 100,00 € a month on the 5th, from the account, with the provider as the payee.
    await page.getByTestId("source-switch-bank_debit").click();
    await sources.getByLabel("Expected amount").fill("100");
    await sources.getByLabel("Debit day").fill("5");
    await sources.getByLabel("Paying account").selectOption({ label: "ING Conto Arancio" });
    await expect(sources.getByLabel("Payee contains")).toHaveValue("Esempio Previdenza");
    await page.getByTestId("source-switch-manual").click();
    await sources.getByRole("button", { name: "Continue" }).click();

    const fees = step(page, "fees");
    await fees.getByRole("button", { name: "Add fee" }).click();
    let dialog = page.getByRole("dialog", { name: "Add fee" });
    await dialog.getByLabel("Name").fill("Quota associativa");
    await dialog.getByLabel("Type").selectOption({ label: "Recurring" });
    await dialog.getByLabel("Value").fill("12");
    // "Applies to" offers the sources switched on in step 2.
    await expect(dialog.getByLabel("Applies to").locator("option")).toContainText([
      "Everything",
      "Payslip",
      "Recurring debit",
      "One-off payments",
    ]);
    await dialog.getByRole("button", { name: "Save fee" }).click();
    await expect(dialog).toBeHidden();
    await fees.getByRole("button", { name: "Add fee" }).click();
    dialog = page.getByRole("dialog", { name: "Add fee" });
    await dialog.getByLabel("Name").fill("Gestione");
    await dialog.getByLabel("Type").selectOption({ label: "On assets" });
    await dialog.getByLabel("Value").fill("0,45");
    await dialog.getByRole("button", { name: "Save fee" }).click();
    await expect(dialog).toBeHidden();
    await expect(fees.getByTestId("fee-row").filter({ visible: true })).toHaveCount(2);
    await fees.getByRole("button", { name: "Continue" }).click();

    // The summary: one line per choice, in three groups, each with its "Edit".
    const review = step(page, "review");
    // An amount is written with a no-break space before its currency: here every space is a space.
    const lines = async (group: string) =>
      (
        await review
          .locator("dt", { hasText: group })
          .locator("xpath=following-sibling::dd[1]")
          .locator("li")
          .allTextContents()
      ).map((line) => line.replace(/\s+/g, " "));
    expect(await lines("The fund")).toEqual([
      "Name: Fondo Completo",
      "Provider: Esempio Previdenza",
      "Line or compartment: Bilanciata",
      `Member since: 1 Mar ${Y - 1}`,
      expect.stringMatching(/^Value today: 1\.200,00 € on \d{1,2} \w{3} \d{4}$/),
    ]);
    expect(await lines("How you pay in")).toEqual([
      "Payslip: My contribution, employer, TFR · by quarter · due on day 20 of the next month · tolerance 15 days",
      "Recurring debit: 100,00 € every month, on day 5 · from ING Conto Arancio · payee contains “Esempio Previdenza”",
      "One-off payments",
    ]);
    expect(await lines("Fees")).toEqual([
      "Quota associativa · 12,00 € per year",
      "Gestione · 0,45 % per year",
    ]);
    for (const group of ["The fund", "How you pay in", "Fees"]) {
      await expect(review.getByRole("button", { name: `Edit: ${group}` })).toBeVisible();
    }
    // "Edit" goes back to its step, and the summary keeps everything.
    await review.getByRole("button", { name: "Edit: Fees" }).click();
    await expect(page).toHaveURL(/step=fees$/);
    await fees.getByRole("button", { name: "Continue" }).click();
    await review.getByRole("button", { name: "Create fund" }).click();

    // The fund's page shows the same choices.
    await expect(page).toHaveURL(/\/funds\/[0-9a-f-]{36}$/);
    const path = new URL(page.url()).pathname;
    await expect(page.getByRole("heading", { name: "Fondo Completo", level: 1 })).toBeVisible();
    await expect(page.getByTestId("fund-meta")).toContainText("Esempio Previdenza · Bilanciata");
    await expect(page.getByTestId("fund-value")).toContainText("1.200,00 €");
    await expect(page.getByTestId("kpi-debit")).toContainText("100,00 €");
    await expect(page.getByRole("banner").getByRole("button", { name: "Record contribution" })).toBeVisible();

    await page.goto(`${path}?tab=contributions`);
    await expect(page.getByTestId("fund-payslips")).toBeVisible();
    await expect(page.getByTestId("fund-quarters")).toBeVisible();
    await expect(page.getByTestId("fund-deposit-rule")).toContainText("100,00 € every month");

    await page.goto(`${path}?tab=settings`);
    const rows = page.getByTestId("source-row");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("Payslip");
    await expect(rows.nth(0)).toContainText(
      "My contribution, employer, TFR · by quarter · due on day 20 of the next month · tolerance 15 days",
    );
    await expect(rows.nth(1)).toContainText("Recurring debit");
    await expect(rows.nth(1)).toContainText("100,00 € every month");
    await expect(rows.nth(1)).toContainText("ING Conto Arancio");
    await expect(rows.nth(2)).toContainText("One-off payments");
    const feeRows = page.getByTestId("fund-fees").getByTestId("fee-row").filter({ visible: true });
    await expect(feeRows).toHaveCount(2);
    await expect(page.getByTestId("fund-fees")).toContainText("Quota associativa");
    await expect(page.getByTestId("fund-fees")).toContainText("12,00 € per year");
    await expect(page.getByTestId("fund-fees")).toContainText("Gestione");
    await expect(page.getByTestId("fund-fees")).toContainText("0,45 % per year");
  });
});

test.describe("the payslip already feeds another fund", () => {
  // `fundsSetup` has "Fondo Busta", whose payslip source holds the three components.
  test.use({ storageState: sessionState("fundsSetup") });

  test("its components are disabled in step 2, each with the fund that holds it", async ({ page }) => {
    await page.goto("/funds/new");
    await form(page).getByLabel("Name").fill("Fondo Secondo");
    await form(page)
      .getByLabel("Member since")
      .fill(`${Y - 1}-03-01`);
    await form(page).getByRole("button", { name: "Continue" }).click();
    await page.getByTestId("source-switch-payroll").click();
    const components = step(page, "sources").getByRole("group", { name: "Components" });
    for (const component of ["My contribution", "Employer", "TFR"]) {
      await expect(components.getByRole("checkbox", { name: component })).toBeDisabled();
    }
    await expect(components.getByText("Already assigned to “Fondo Busta”")).toHaveCount(3);
    // Nothing was written: the form is left with its own "Leave" question.
    await page.getByRole("banner").getByRole("link", { name: "Funds" }).click();
    const leave = page.getByRole("dialog", { name: "Leave without creating the fund?" });
    await leave.getByRole("button", { name: "Leave" }).click();
    await expect(page).toHaveURL(/\/funds$/);
    await expect(page.getByRole("link", { name: "Fondo Secondo" })).toHaveCount(0);
  });
});
