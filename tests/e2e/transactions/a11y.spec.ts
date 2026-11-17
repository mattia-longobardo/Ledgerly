// tests/e2e/transactions/a11y.spec.ts — the screens of the flow `transactions` in the layout and
// accessibility check: what is measured, and why, is in tests/e2e/_shared/a11y.ts.
import { expect, test } from "@playwright/test";
import { audit, go, type Screen, settled, settledDialog } from "../_shared/a11y";

const PAGES: Screen[] = [
  { name: "/expenses", session: "layout", smoke: true, open: go("/expenses") },

  // Release N3 (ux/n3-categories-manual.md §9, §12): the `manual` user has a movement written by
  // hand, so the row with its badge is measured, in the table and in the phone's list.
  { name: "/expenses (a manual movement)", session: "manual", open: go("/expenses?preset=last3Months") },

  // Release N3.1 (ux §6.4, §9.8): the `sources` user has an account of a source that takes the
  // movements written here — a row that waits and one that was not taken — and the categories of
  // that source, one matched and one new.
  {
    name: "/expenses (a manual movement to send)",
    session: "sources",
    open: go("/expenses?preset=last3Months"),
  },
];

const OVERLAYS: Screen[] = [
  {
    // Release N3: the manual movement's dialog, on the account a bank reads — the warning, the
    // balance line and every field are on screen.
    name: "the add transaction dialog",
    session: "manual",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await page.goto("/expenses");
      await settled(page);
      await page
        .getByRole("button", { name: /^(Add transaction|Aggiungi movimento|Add|Aggiungi)$/ })
        .first()
        .click();
      await settledDialog(page);
      const form = page.getByTestId("manual-dialog");
      await expect(form.getByLabel(/^(Account|Conto)$/)).toBeEnabled();
      await form.getByLabel(/^(Account|Conto)$/).selectOption({ label: "Zeta Bank conto" });
      await form.getByLabel(/^(Amount|Importo)$/).fill("12,34");
      await expect(page.getByTestId("manual-balance-line")).toBeVisible();
    },
  },
  {
    // Release N3.1: the same dialog on an account whose source takes the movement — its group
    // under the source's name and the note that says when the movement goes.
    name: "the add transaction dialog on an account of a source",
    session: "sources",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await page.goto("/expenses");
      await settled(page);
      await page
        .getByRole("button", { name: /^(Add transaction|Aggiungi movimento|Add|Aggiungi)$/ })
        .first()
        .click();
      await settledDialog(page);
      const form = page.getByTestId("manual-dialog");
      await expect(form.getByLabel(/^(Account|Conto)$/)).toBeEnabled();
      await form.getByLabel(/^(Account|Conto)$/).selectOption({ label: "Conto corrente app" });
      await form.getByLabel(/^(Amount|Importo)$/).fill("12,34");
      await expect(page.getByTestId("manual-send-note")).toBeVisible();
    },
  },
  {
    name: "the delete manual transaction dialog",
    session: "manual",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await page.goto("/expenses?preset=last3Months");
      await settled(page);
      await page
        .locator('button[aria-label="Row actions"], button[aria-label="Azioni sulla riga"]')
        .locator("visible=true")
        .first()
        .click();
      await page.getByRole("menuitem", { name: /^(Delete|Elimina)$/ }).click();
      await settledDialog(page);
    },
  },
];

test.describe("every screen", () => audit(PAGES));
test.describe("every overlay", () => audit(OVERLAYS));
