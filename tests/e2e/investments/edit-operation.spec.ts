// tests/e2e/investments/edit-operation.spec.ts — «Edit» of an operation of a manual portfolio (PERS-693)
// at 1440 px: the Activity by the day of the operation, a purchase rewritten (quantity, price, day) and
// refused for lack of cash, a deposit moved to another account, and no «Edit» on a synced service. The
// figures and the pairing are the API's: the client sends the form, and reads the answer back.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { sessionState } from "../_shared/env";
import { TODAY } from "../_shared/helpers";

test.describe.configure({ mode: "serial" });

/** The instrument of the seed, known to the registry: the search asks no register. */
const ISIN = "IE00BK5BQT80";

/** `TODAY` moved by `days`, as the date field takes it. */
function dayFrom(days: number): string {
  const day = new Date(`${TODAY}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

const tabs = (page: Page) => page.getByRole("navigation", { name: "Sections of the service" });

/** Opens a service on its Activity of every period. */
async function openActivity(page: Page, name: string): Promise<void> {
  await page.goto("/investments?preset=all");
  const link = page.getByRole("link", { name, exact: true }).filter({ visible: true }).first();
  await page.goto((await link.getAttribute("href"))!);
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  await tabs(page).getByRole("link", { name: "Activity" }).click();
  await expect(page.getByTestId("activity-row").first()).toBeVisible();
}

/** The amounts of the Activity's rows, top to bottom. */
async function amounts(page: Page): Promise<string[]> {
  const rows = await page.getByTestId("activity-row").allTextContents();
  return rows.map((row) => row.match(/\d{1,3}(?:\.\d{3})*,\d{2}/g)?.at(-1) ?? "");
}

/** «Edit» from the menu of the row of `amount`. */
async function openEdit(page: Page, amount: string): Promise<Locator> {
  const row = page.getByTestId("activity-row").filter({ hasText: amount });
  await row.getByRole("button", { name: /^Actions for the operation of / }).click();
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit operation · Broker" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("a manual portfolio", () => {
  // Its own user: «Broker» with three deposits written out of date order (scripts/seed-e2e/investments.ts).
  test.use({ storageState: sessionState("editOps") });

  test("«Edit» rewrites a purchase and a deposit; the Activity lists by day", async ({ page }) => {
    await test.step("the Activity is by day, newest first; on one day the last written first", async () => {
      await openActivity(page, "Broker");
      // Written 5.000 (ten days ago), 100 (twenty days ago), 200 (ten days ago).
      expect(await amounts(page)).toEqual(["200,00", "5.000,00", "100,00"]);
    });

    await test.step("a purchase recorded five days ago goes on top", async () => {
      await page.getByRole("button", { name: "Record operation" }).click();
      const dialog = page.getByRole("dialog", { name: "Record operation · Broker" });
      await dialog.getByLabel("Date").fill(dayFrom(-5));
      await dialog.getByRole("searchbox", { name: "Instrument" }).fill(ISIN);
      await dialog.getByTestId("instrument-hit").first().click();
      await dialog.getByLabel("Quantity").fill("10");
      await dialog.getByLabel("Unit price").fill("100");
      await dialog.getByLabel("Fee").fill("1");
      await dialog.getByRole("button", { name: "Save" }).click();
      await expect(dialog).toBeHidden();
      await expect.poll(() => amounts(page)).toEqual(["1.000,00", "200,00", "5.000,00", "100,00"]);
    });

    await test.step("«Edit» opens the purchase as it was typed, and keeps its kind", async () => {
      const dialog = await openEdit(page, "1.000,00");
      await expect(dialog.getByLabel("Type")).toHaveValue("buy");
      await expect(dialog.getByLabel("Type")).toBeDisabled();
      await expect(dialog.getByLabel("Date")).toHaveValue(dayFrom(-5));
      await expect(dialog.getByTestId("instrument-current")).toContainText("XMIL");
      await expect(dialog.getByLabel("Quantity")).toHaveValue(/^10(,0*)?$/);
      await expect(dialog.getByLabel("Unit price")).toHaveValue(/^100(,0*)?$/);
      await expect(dialog.getByLabel("Fee")).toHaveValue(/^1(,0*)?$/);
    });

    await test.step("the server's refusal stays on the form, in its words", async () => {
      const dialog = page.getByRole("dialog", { name: "Edit operation · Broker" });
      await dialog.getByLabel("Quantity").fill("1000");
      await dialog.getByRole("button", { name: "Save" }).click();
      await expect(dialog.getByRole("alert")).toContainText("Not enough cash on that day");
    });

    await test.step("quantity, price and day rewritten: the row, the position and the cash follow", async () => {
      const dialog = page.getByRole("dialog", { name: "Edit operation · Broker" });
      await dialog.getByLabel("Date").fill(dayFrom(-3));
      await dialog.getByLabel("Quantity").fill("12");
      await dialog.getByLabel("Unit price").fill("90");
      await dialog.getByRole("button", { name: "Save" }).click();
      await expect(dialog).toBeHidden();
      await expect.poll(() => amounts(page)).toEqual(["1.080,00", "200,00", "5.000,00", "100,00"]);
      await tabs(page).getByRole("link", { name: "Positions" }).click();
      await expect(page.getByTestId("open-row").filter({ hasText: "Vanguard" })).toContainText("12");
      // 5.300 in, 1.080 and a fee of 1 out.
      await expect(page.getByTestId("cash-row")).toContainText("4.219,00");
    });

    await test.step("a deposit moved to another account reads back on that account", async () => {
      await tabs(page).getByRole("link", { name: "Activity" }).click();
      let dialog = await openEdit(page, "5.000,00");
      const from = dialog.getByLabel("From account");
      await expect(from.locator("option:checked")).toHaveText("Conto deposito");
      await from.selectOption({ label: "Conto corrente" });
      await dialog.getByRole("button", { name: "Save" }).click();
      await expect(dialog).toBeHidden();
      dialog = await openEdit(page, "5.000,00");
      await expect(dialog.getByLabel("From account").locator("option:checked")).toHaveText("Conto corrente");
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    });
  });
});

test.describe("a synced service", () => {
  // The seeded `layout` user's eToro: its events are the provider's.
  test.use({ storageState: sessionState("layout") });

  test("has no «Edit»: its rows have no operation menu", async ({ page }) => {
    await openActivity(page, "eToro");
    await expect(page.getByRole("button", { name: /^Actions for the operation of / })).toHaveCount(0);
  });
});
