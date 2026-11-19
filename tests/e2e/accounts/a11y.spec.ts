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
];

test.describe("every screen", () => audit(PAGES));
test.describe("every overlay", () => audit(OVERLAYS));
