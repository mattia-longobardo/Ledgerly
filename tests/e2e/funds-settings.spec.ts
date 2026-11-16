// tests/e2e/funds-settings.spec.ts — the Settings tab of a fund (release N6,
// docs/design/rewrite-plan/ux/n6-pension-fund.md §6, §7, §16.3): the sources and the fees are lists a
// person edits, on the funds of the `fundsSetup` seed — one fund per journey.
import { expect, type Page, test } from "@playwright/test";
import { sessionState } from "./env";

// The tests of this file change the data of one user, each from what the one before left: they run
// in order, on one worker, while the other files run beside them (playwright.preview.config.ts).
test.describe.configure({ mode: "default" });

const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(new Date());
const Y = Number(TODAY.slice(0, 4));

/** The Settings tab of a fund, by its name: the id is read from the home, never written down. */
async function openSettings(page: Page, name: string): Promise<string> {
  await page.goto("/funds?preset=all");
  const href = await page
    .getByRole("link", { name, exact: true })
    .filter({ visible: true })
    .first()
    .getAttribute("href");
  const path = href!.split("?")[0];
  await page.goto(`${path}?tab=settings`);
  await expect(page.getByTestId("fund-sources")).toBeVisible();
  return path;
}

const toast = (page: Page, text: string) =>
  page.getByRole("region", { name: "Notifications" }).getByText(text, { exact: true });

test.describe("the settings of a fund", () => {
  test.use({ storageState: sessionState("fundsSetup") });

  test("the four sections, in their order, each with its anchor", async ({ page }) => {
    await openSettings(page, "Fondo Vuoto");
    await expect(page.locator("main").getByRole("heading", { level: 2 })).toHaveText([
      "General",
      "Contributions",
      "Fees",
      "Danger zone",
    ]);
    for (const anchor of ["sources", "fees"]) {
      await expect(page.locator(`#${anchor}`)).toBeVisible();
    }
    // Settings do not follow the period, and say no fund kind.
    await expect(page.getByRole("group", { name: "Date range" })).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText(/PAC|Fund kind|Deductible/);
    await expect(page.getByText("The value is kept on the account “Fondo Vuoto”.")).toBeVisible();
  });

  test("a fee is added, edited and removed with Undo; the yearly cost on assets is estimated", async ({
    page,
  }) => {
    await openSettings(page, "Fondo Costi");
    const fees = page.getByTestId("fund-fees");
    const rows = fees.getByTestId("fee-row").filter({ visible: true });
    await expect(fees).toContainText("Fees not set");
    await expect(fees).not.toContainText("Estimated yearly cost");

    await test.step("add: a yearly percentage on assets, and the cost it makes", async () => {
      await fees.getByRole("button", { name: "Add fee" }).click();
      const dialog = page.getByRole("dialog", { name: "Add fee" });
      // What is wrong is said under its field, and nothing is saved.
      await dialog.getByRole("button", { name: "Save fee" }).click();
      await expect(dialog).toContainText("Enter a name.");
      await dialog.getByLabel("Name").fill("Gestione");
      await dialog.getByLabel("Type").selectOption({ label: "On assets" });
      await expect(dialog).toContainText(
        "Yearly percentage of the value. It is already inside the fund's value.",
      );
      // On assets is a percentage alone: the choice between amount and percentage is not offered.
      await expect(dialog.getByRole("group", { name: "Amount or percentage" })).toHaveCount(0);
      await dialog.getByLabel("Value").fill("0,45");
      await dialog.getByRole("button", { name: "Save fee" }).click();
      await expect(dialog).toBeHidden();
      await expect(toast(page, "Fee saved")).toBeVisible();
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText("Gestione");
      await expect(rows.first()).toContainText("On assets");
      await expect(rows.first()).toContainText("0,45 % per year");
      // 0,45 % of the 9.000,00 € the fund is worth today.
      await expect(fees).toContainText(
        /Estimated yearly cost on assets: about 40,50\s€ \(0,45\s% of 9\.000,00\s€, value of [^)]+\)\. It is already inside the value: Ledgerly does not subtract it\./,
      );
    });

    await test.step("add: an amount on each contribution", async () => {
      await fees.getByRole("button", { name: "Add fee" }).click();
      const dialog = page.getByRole("dialog", { name: "Add fee" });
      await dialog.getByLabel("Name").fill("Per versamento");
      await dialog.getByLabel("Type").selectOption({ label: "On each contribution" });
      await dialog.getByLabel("Value").fill("1,5");
      await dialog.getByRole("button", { name: "Save fee" }).click();
      await expect(dialog).toBeHidden();
      await expect(rows).toHaveCount(2);
      await expect(fees).toContainText("1,50 € per contribution");
    });

    await test.step("edit: the dialog opens filled, and the estimate follows", async () => {
      await fees.getByRole("button", { name: "Edit Gestione" }).filter({ visible: true }).click();
      const dialog = page.getByRole("dialog", { name: "Edit fee" });
      await expect(dialog.getByLabel("Name")).toHaveValue("Gestione");
      await expect(dialog.getByLabel("Value")).toHaveValue("0,45");
      await dialog.getByLabel("Value").fill("0,5");
      await dialog.getByRole("button", { name: "Save fee" }).click();
      await expect(dialog).toBeHidden();
      await expect(fees).toContainText("0,5 % per year");
      await expect(fees).toContainText("about 45,00 € (0,50 % of 9.000,00 €");
      await expect(rows).toHaveCount(2);
    });

    await test.step("remove: at once, with Undo in the toast", async () => {
      page.on("dialog", () => {
        throw new Error("Remove asks with a window.confirm");
      });
      await fees.getByRole("button", { name: "Remove Per versamento" }).filter({ visible: true }).click();
      await expect(toast(page, "Fee removed")).toBeVisible();
      await expect(rows).toHaveCount(1);
      await expect(fees).not.toContainText("Per versamento");
      await page.getByRole("region", { name: "Notifications" }).getByRole("button", { name: "Undo" }).click();
      await expect(toast(page, "Fee removed")).toHaveCount(0);
      await expect(rows).toHaveCount(2);
      await expect(fees).toContainText("1,50 € per contribution");
      // And for good: the row stays away after a reload.
      await fees.getByRole("button", { name: "Remove Per versamento" }).filter({ visible: true }).click();
      await expect(rows).toHaveCount(1);
      // The row leaves the list before the server answers; the toast comes after its answer. A
      // reload sent before it reads the fee still there, and says the removal did not hold.
      await expect(toast(page, "Fee removed")).toBeVisible();
      await page.reload();
      await expect(rows).toHaveCount(1);
      await expect(fees).toContainText("Gestione");
      await expect(fees).not.toContainText("Per versamento");
    });
  });

  test("a recurring debit every N weeks, months or years, with a start and an end, is saved and read back", async ({
    page,
  }) => {
    const path = await openSettings(page, "Fondo Sorgenti");
    const sources = page.getByTestId("fund-sources");
    const row = page.getByTestId("source-row").filter({ hasText: "Recurring debit" });
    await expect(sources).toContainText("No source");

    await test.step("every 2 weeks, between two dates", async () => {
      await sources.getByRole("button", { name: "Add source" }).click();
      await page.getByRole("menuitem", { name: "Recurring debit" }).click();
      const dialog = page.getByRole("dialog", { name: "Recurring debit" });
      // What is missing is said under its field.
      await dialog.getByLabel("Payee contains").fill("");
      await dialog.getByRole("button", { name: "Save source" }).click();
      await expect(dialog).toContainText("Enter the expected amount.");
      await expect(dialog).toContainText("Enter a part of the payee's name.");
      await dialog.getByLabel("Expected amount").fill("300");
      await dialog.getByLabel("Frequency").fill("2");
      await dialog.getByLabel("Unit of time").selectOption("week");
      // A week has no day of the month.
      await expect(dialog.getByLabel("Debit day")).toHaveCount(0);
      await dialog.getByLabel("Start date").fill(`${Y}-01-01`);
      await dialog.getByLabel("End date").fill(`${Y - 1}-12-31`);
      await dialog.getByLabel("Payee contains").fill("Esempio");
      await dialog.getByRole("button", { name: "Save source" }).click();
      await expect(dialog).toContainText("The end date cannot be before the start date.");
      await dialog.getByLabel("End date").fill(`${Y + 1}-12-31`);
      await dialog.getByRole("button", { name: "Save source" }).click();
      await expect(dialog).toBeHidden();
      await expect(toast(page, "Source saved")).toBeVisible();
      await expect(page.getByTestId("source-row")).toHaveCount(1);
      await expect(row).toContainText(
        `300,00 € every 2 weeks · payee contains “Esempio” · from 1 Jan ${Y} · until 31 Dec ${Y + 1}`,
      );
    });

    await test.step("every 3 months on the 10th, then every year: the dialog opens filled each time", async () => {
      await row.getByRole("button", { name: "Edit Recurring debit" }).click();
      let dialog = page.getByRole("dialog", { name: "Recurring debit" });
      await expect(dialog.getByLabel("Expected amount")).toHaveValue("300,00");
      await expect(dialog.getByLabel("Frequency")).toHaveValue("2");
      await expect(dialog.getByLabel("Unit of time")).toHaveValue("week");
      await expect(dialog.getByLabel("Start date")).toHaveValue(`${Y}-01-01`);
      await expect(dialog.getByLabel("End date")).toHaveValue(`${Y + 1}-12-31`);
      await dialog.getByLabel("Frequency").fill("3");
      await dialog.getByLabel("Unit of time").selectOption("month");
      await dialog.getByLabel("Debit day").fill("10");
      await dialog.getByRole("button", { name: "Save source" }).click();
      await expect(dialog).toBeHidden();
      await expect(row).toContainText(
        `300,00 € every 3 months, on day 10 · payee contains “Esempio” · from 1 Jan ${Y} · until 31 Dec ${Y + 1}`,
      );

      await row.getByRole("button", { name: "Edit Recurring debit" }).click();
      dialog = page.getByRole("dialog", { name: "Recurring debit" });
      await expect(dialog.getByLabel("Frequency")).toHaveValue("3");
      await expect(dialog.getByLabel("Unit of time")).toHaveValue("month");
      await expect(dialog.getByLabel("Debit day")).toHaveValue("10");
      await dialog.getByLabel("Frequency").fill("1");
      await dialog.getByLabel("Unit of time").selectOption("year");
      await dialog.getByLabel("End date").fill("");
      await dialog.getByRole("button", { name: "Save source" }).click();
      await expect(dialog).toBeHidden();
      await expect(row).toContainText(
        `300,00 € every year, on day 10 · payee contains “Esempio” · from 1 Jan ${Y}`,
      );
      await expect(row).not.toContainText("until");
      // The same sentence on the Contributions tab and in the Overview's figure.
      await page.goto(`${path}?tab=contributions`);
      await expect(page.getByTestId("fund-deposit-rule")).toContainText("300,00 € every year");
      await expect(page.getByTestId("fund-deposit-rule")).toContainText("Active");
      await page.goto(path);
      await expect(page.getByTestId("kpi-debit")).toContainText("300,00 €");
      await expect(page.getByTestId("kpi-debit")).toContainText("every year, on day 10");
    });
  });

  test("a source is added, paused, resumed and removed with Undo; one-off payments exist once", async ({
    page,
  }) => {
    const path = await openSettings(page, "Fondo Pausa");
    const sources = page.getByTestId("fund-sources");
    const rows = page.getByTestId("source-row");
    const debit = rows.filter({ hasText: "Recurring debit" });
    const menu = (kind: string) => page.getByRole("button", { name: `Actions for ${kind}` });

    await test.step("add a debit and one-off payments", async () => {
      await sources.getByRole("button", { name: "Add source" }).click();
      await page.getByRole("menuitem", { name: "Recurring debit" }).click();
      const dialog = page.getByRole("dialog", { name: "Recurring debit" });
      await dialog.getByLabel("Expected amount").fill("100");
      await dialog.getByLabel("Debit day").fill("5");
      await dialog.getByLabel("Paying account").selectOption({ label: "ING Conto Arancio" });
      // The payee starts from the fund's provider.
      await expect(dialog.getByLabel("Payee contains")).toHaveValue("Esempio");
      await dialog.getByRole("button", { name: "Save source" }).click();
      await expect(dialog).toBeHidden();
      await expect(debit).toContainText(
        "100,00 € every month, on day 5 · from ING Conto Arancio · payee contains “Esempio”",
      );

      await sources.getByRole("button", { name: "Add source" }).click();
      await page.getByRole("menuitem", { name: "One-off payments" }).click();
      await expect(rows).toHaveCount(2);
      await expect(rows.filter({ hasText: "One-off payments" })).toContainText(
        "Contributions entered by hand.",
      );
      // One "One-off payments" per fund: the menu offers it no more.
      await sources.getByRole("button", { name: "Add source" }).click();
      await expect(page.getByRole("menuitem", { name: "One-off payments" })).toBeDisabled();
      await page.keyboard.press("Escape");
      // It puts "Record contribution" at the top of the fund's page.
      await expect(
        page.getByRole("banner").getByRole("button", { name: "Record contribution" }),
      ).toBeVisible();
    });

    await test.step("pause the debit: its badge, and nothing waits for it any more", async () => {
      await page.goto(path);
      await expect(page.getByTestId("kpi-debit")).toContainText("100,00 €");
      await page.goto(`${path}?tab=settings`);
      await menu("Recurring debit").click();
      await page.getByRole("menuitem", { name: "Pause" }).click();
      await expect(debit).toContainText("Paused");
      await page.goto(`${path}?tab=contributions`);
      await expect(page.getByTestId("fund-deposit-rule")).toContainText("Paused");
      await page.goto(path);
      await expect(page.getByTestId("kpi-debit")).toHaveCount(0);
      await expect(page.getByTestId("fund-alert")).toHaveCount(0);

      await page.goto(`${path}?tab=settings`);
      await menu("Recurring debit").click();
      await page.getByRole("menuitem", { name: "Resume" }).click();
      await expect(debit).not.toContainText("Paused");
    });

    await test.step("remove a source with no contribution: at once, with Undo", async () => {
      page.on("dialog", () => {
        throw new Error("Remove asks with a window.confirm");
      });
      await menu("Recurring debit").click();
      await page.getByRole("menuitem", { name: "Remove", exact: true }).click();
      await expect(toast(page, "Source removed")).toBeVisible();
      await expect(rows).toHaveCount(1);
      await page.getByRole("region", { name: "Notifications" }).getByRole("button", { name: "Undo" }).click();
      await expect(rows).toHaveCount(2);
      await expect(debit).toContainText("100,00 € every month, on day 5");
    });
  });

  test("a payslip component another fund holds is disabled, with the fund's name", async ({ page }) => {
    await openSettings(page, "Fondo Vuoto");
    await page.getByTestId("fund-sources").getByRole("button", { name: "Add source" }).click();
    await page.getByRole("menuitem", { name: "Payslip" }).click();
    const dialog = page.getByRole("dialog", { name: "Payslip" });
    const components = dialog.getByRole("group", { name: "Components" });
    for (const component of ["My contribution", "Employer", "TFR"]) {
      await expect(components.getByRole("checkbox", { name: component })).toBeDisabled();
      await expect(components.getByRole("checkbox", { name: component })).not.toBeChecked();
    }
    await expect(components.getByText("Already assigned to “Fondo Busta”")).toHaveCount(3);
    // With no component left to choose the source cannot be saved.
    await dialog.getByRole("button", { name: "Save source" }).click();
    await expect(dialog).toContainText("Choose at least one component.");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("source-row")).toHaveCount(0);

    // The fund that holds them offers its own three, all chosen.
    await openSettings(page, "Fondo Busta");
    await page.getByRole("button", { name: "Edit Payslip" }).click();
    const own = page.getByRole("dialog", { name: "Payslip" }).getByRole("group", { name: "Components" });
    for (const component of ["My contribution", "Employer", "TFR"]) {
      await expect(own.getByRole("checkbox", { name: component })).toBeEnabled();
      await expect(own.getByRole("checkbox", { name: component })).toBeChecked();
    }
  });
});

test.describe("a source with contributions", () => {
  // "Pensione Beta" of `fundsDetail`: four operations a document left on its payslip source.
  test.use({ storageState: sessionState("fundsDetail") });

  test("has no Remove: the disabled item says how many contributions it has", async ({ page }) => {
    await openSettings(page, "Pensione Beta");
    await page.getByRole("button", { name: "Actions for Payslip" }).click();
    const blocked = page.getByRole("menuitem", { name: "Remove · it has 4 contributions" });
    await expect(blocked).toBeVisible();
    await expect(blocked).toBeDisabled();
    await expect(page.getByRole("menuitem", { name: "Remove", exact: true })).toHaveCount(0);
    // What it does have is the pause: this one is paused, so it offers "Resume".
    await expect(page.getByRole("menuitem", { name: "Resume" })).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("source-row")).toHaveCount(1);
  });
});
