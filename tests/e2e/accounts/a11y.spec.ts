// tests/e2e/accounts/a11y.spec.ts — the screens of the flow `accounts` in the layout and
// accessibility check: what is measured, and why, is in tests/e2e/_shared/a11y.ts.
import { type Page, test } from "@playwright/test";
import { audit, follow, go, openTab, type Screen, settled, settledDialog } from "../_shared/a11y";

const PAGES: Screen[] = [
  { name: "/", session: "layout", smoke: true, open: go("/") },
  { name: "/accounts", session: "layout", smoke: true, open: go("/accounts") },
  { name: "/accounts/new", session: "layout", open: go("/accounts/new") },
  {
    name: "/accounts/[id]",
    session: "layout",
    open: (page) => follow(page, "/accounts", "ING Conto Arancio"),
  },
  // A page's tabs are screens of their own: the widest tables of the app live on them, and a tab
  // nobody opens is a tab nobody measures.
  ...(["transactions", "entries", "settings"] as const).map((tab) => ({
    name: `/accounts/[id]?tab=${tab}`,
    session: "layout" as const,
    open: async (page: Page) => {
      await follow(page, "/accounts", "ING Conto Arancio");
      await openTab(page, tab);
    },
  })),

  // Release N4b (ux/n4-account-switch.md §2.2, §4): the `switching` user has an account of a source
  // and the same account in a bank, not imported: the block of the settings and the step "Account".
  {
    name: "/accounts/[id] (settings, move to the bank)",
    session: "switching",
    open: async (page) => {
      await page.goto("/accounts");
      await page.getByRole("link", { name: "Conto da passare" }).first().click();
      await page.waitForURL(/\/accounts\/[0-9a-f-]{36}$/);
      await page.goto(`${new URL(page.url()).pathname}?tab=settings`);
      await settled(page);
    },
  },
  {
    name: "/accounts/[id]/switch (account of the bank)",
    session: "switching",
    open: async (page) => {
      await page.goto("/accounts");
      await page.getByRole("link", { name: "Conto da passare" }).first().click();
      await page.waitForURL(/\/accounts\/[0-9a-f-]{36}$/);
      await page.goto(`${new URL(page.url()).pathname}/switch`);
      await settled(page);
    },
  },
];

const OVERLAYS: Screen[] = [
  {
    name: "the new account dialog",
    session: "layout",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await page.goto("/pockets");
      await settled(page);
      await page
        .getByRole("button", { name: /Add pocket|New pocket|Aggiungi/ })
        .first()
        .click();
      await settledDialog(page);
    },
  },
  {
    // Decision H58: the confirmation before an account that doubles another is archived. Opened only.
    name: "the dialog of archiving a double",
    session: "switching",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await page.goto("/accounts");
      await page.getByRole("link", { name: "Conto doppio" }).first().click();
      await page.waitForURL(/\/accounts\/[0-9a-f-]{36}$/);
      await page.goto(`${new URL(page.url()).pathname}?tab=settings`);
      await settled(page);
      await page.getByRole("button", { name: "Archive account" }).click();
      await settledDialog(page);
    },
  },
  // The dialog that adds what hangs off an account (its «Connections»). Opened only: nothing is saved.
  {
    name: "the add connection dialog",
    session: "layout",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await follow(page, "/accounts", "ING Conto Arancio");
      await openTab(page, "settings");
      await page
        .getByRole("region", { name: "Connections" })
        .getByRole("button", { name: "Add" })
        .first()
        .click();
      await settledDialog(page);
    },
  },
  // Release R5c (decision ST-8): «Import CSV» of an account «a mano», its file and its columns. The
  // preview writes nothing, so the shared `layout` user is left as it was.
  {
    name: "the CSV import dialog",
    session: "layout",
    roots: ['[role="dialog"]'],
    open: openCsvImport,
  },
  {
    name: "the CSV import dialog, columns",
    session: "layout",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await openCsvImport(page);
      await page.getByLabel("File", { exact: true }).setInputFiles({
        name: "movements.csv",
        mimeType: "text/csv",
        buffer: Buffer.from("Date;Payee;Amount\n14/10/2026;Shop;-12,50\n15/10/2026;Bakery;-3,20\n"),
      });
      await page.getByRole("button", { name: "Read the file" }).click();
      await page.getByRole("heading", { name: "First rows" }).waitFor();
      await settledDialog(page);
    },
  },
];

async function openCsvImport(page: Page) {
  await follow(page, "/accounts", "Revolut Saving");
  await page.getByRole("button", { name: "Import CSV" }).click();
  await settledDialog(page);
}

test.describe("every screen", () => audit(PAGES));
test.describe("every overlay", () => audit(OVERLAYS));
