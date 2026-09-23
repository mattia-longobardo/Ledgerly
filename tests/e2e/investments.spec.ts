// tests/e2e/investments.spec.ts — the Investments journey at 1440 px: platforms with their link,
// deposits and withdrawals linked (or not) to an account movement, a value and the gain it gives,
// the spreadsheet import, and the deletions that ask first.
import { expect, test } from "@playwright/test";
import { sessionState } from "./env";

// Its own user: no platform yet, and two bank movements to link (scripts/seed-e2e.ts).
test.use({ storageState: sessionState("investments") });

const SHEET = "tests/fixtures/investments/sheet.csv";

test("a platform keeps its money's history, and linking it to the bank moves no balance", async ({
  page,
}) => {
  await test.step("an empty page offers a platform or an import", async () => {
    await page.goto("/investments");
    await expect(page.getByRole("heading", { name: "No platforms" })).toBeVisible();
  });

  await test.step("a new platform carries a link that opens it in a new tab", async () => {
    await page.getByRole("button", { name: "New platform" }).first().click();
    const dialog = page.getByRole("dialog", { name: "New platform" });
    await dialog.getByLabel("Name").fill("eToro");
    await dialog.getByLabel("Link").fill("www.etoro.com");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/platform=/);
    const open = page.getByTestId("platform-detail").getByRole("link", { name: "Open eToro" });
    await expect(open).toHaveAttribute("href", "https://www.etoro.com");
    await expect(open).toHaveAttribute("target", "_blank");
  });

  await test.step("a deposit linked to the money that left the account", async () => {
    await page.getByRole("button", { name: "New movement" }).first().click();
    const dialog = page.getByRole("dialog", { name: "New movement" });
    await dialog.getByLabel("Amount").fill("2000");
    const link = dialog.getByLabel("Linked account expense");
    await link.selectOption({ label: await optionLabel(link, "Bonifico eToro") });
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("movement-row").first()).toContainText(
      "Bonifico eToro · ING Conto Arancio",
    );
  });

  await test.step("a withdrawal linked to the money that came back", async () => {
    await page.getByRole("button", { name: "New movement" }).first().click();
    const dialog = page.getByRole("dialog", { name: "New movement" });
    await dialog.getByRole("button", { name: "Withdrawal" }).click();
    await dialog.getByLabel("Amount").fill("2401,58");
    const link = dialog.getByLabel("Linked account income");
    // Only money coming in is offered for a withdrawal.
    await expect(link.locator("option", { hasText: "Bonifico eToro" })).toHaveCount(0);
    await link.selectOption({ label: await optionLabel(link, "Accredito eToro") });
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("movement-row")).toHaveCount(2);
  });

  await test.step("with its value known, the platform shows what it gained", async () => {
    // Nobody has valued it yet: the value and the gain are unknown, never zero.
    await expect(page.getByText("eToro. Update the value")).toBeVisible();
    await page.getByRole("button", { name: "Actions for eToro" }).first().click();
    await page.getByRole("menuitem", { name: "Update value" }).click();
    const dialog = page.getByRole("dialog", { name: "Update value · eToro" });
    await dialog.getByLabel("Value").fill("0");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("platform-row")).toContainText(/\+401,58\s€/);
    await expect(page.getByTestId("platform-row")).toContainText(/\+20,1\s%/);
  });

  await test.step("the spreadsheet imports once, creating the platforms it names", async () => {
    await page.goto("/investments");
    await page.getByRole("button", { name: "Import CSV" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Import CSV" });
    await dialog.locator('input[type="file"]').setInputFiles(SHEET);
    await dialog.getByRole("button", { name: "Import" }).click();
    await expect(page.getByText("5 movements imported, 0 already there, 2 platforms created")).toBeVisible();
    await expect(page.getByTestId("platform-row")).toHaveCount(3);

    await page.getByRole("button", { name: "Import CSV" }).first().click();
    await dialog.locator('input[type="file"]').setInputFiles(SHEET);
    await dialog.getByRole("button", { name: "Import" }).click();
    await expect(page.getByText("0 movements imported, 5 already there, 0 platforms created")).toBeVisible();
    await expect(page.getByTestId("movement-row")).toHaveCount(7);
  });

  await test.step("deleting a platform asks first, and says what went with it", async () => {
    await page.getByRole("button", { name: "Actions for Beta Exchange" }).first().click();
    await page.getByRole("menuitem", { name: "Delete platform" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete Beta Exchange?" });
    await expect(dialog).toContainText("2 movements and the recorded values go too.");
    await dialog.getByRole("button", { name: "Delete platform" }).click();
    await expect(page.getByText("Beta Exchange deleted with 2 movements")).toBeVisible();
    await expect(page.getByTestId("platform-row")).toHaveCount(2);
  });

  await test.step("the account's balance did not move", async () => {
    await page.goto("/accounts");
    await expect(page.getByRole("row").filter({ hasText: "ING Conto Arancio" }).first()).toContainText(
      "5.000,00 €",
    );
  });
});

/** The full text of the first option naming `payee`: dates and amounts make up the rest of it. */
async function optionLabel(select: import("@playwright/test").Locator, payee: string): Promise<string> {
  const option = select.locator("option", { hasText: payee }).first();
  await expect(option).toHaveCount(1);
  return (await option.textContent()) ?? "";
}
