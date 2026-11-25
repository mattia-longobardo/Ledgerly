// tests/e2e/connections/a11y.spec.ts — the screens of the flow `connections` in the layout and
// accessibility check: what is measured, and why, is in tests/e2e/_shared/a11y.ts.
import { expect, test } from "@playwright/test";
import { audit, go, type Screen, settled, settledDialog } from "../_shared/a11y";

const PAGES: Screen[] = [
  { name: "/settings/plugins", session: "layout", smoke: true, open: go("/settings/plugins") },
  // Release N1: the layout user has the bank plugin on with nothing saved, so the page above has
  // the plugin's row "Active" and the section "Banks" on its guide; the admin's has "Not active".
  // The procedure, for the same user, stops at its guard.
  { name: "/banks/connect (no credentials)", session: "layout", open: go("/banks/connect") },
  // Release N7.2 (plugin-settings.md §2): the page of each source, with every setting of its own.
  // The layout user: the bank plugin on its guide, Trek with its schedule, Wallet with nothing.
  {
    name: "/settings/plugins/[source] (plugin, guide)",
    session: "layout",
    open: go("/settings/plugins/enablebanking"),
  },
  {
    name: "/settings/plugins/[source] (schedule)",
    session: "layout",
    open: go("/settings/plugins/trek"),
  },
  {
    name: "/settings/plugins/[source] (not connected)",
    session: "layout",
    open: go("/settings/plugins/wallet"),
  },
  // Release N2: "Advanced", with the schedule of each of this user's services and the log.
  {
    name: "/settings/plugins/advanced",
    session: "layout",
    open: go("/settings/plugins/advanced"),
  },

  // Release N2 (ux/n2-connection-status.md §12): the `connections` user has a connection in each
  // of the five states, a warning that an access is about to end, and more than one bank.
  {
    name: "/settings/plugins (five states)",
    session: "connections",
    open: go("/settings/plugins"),
  },
  {
    name: "/settings/plugins/[source] (six banks)",
    session: "connections",
    open: go("/settings/plugins/enablebanking"),
  },
  {
    name: "/settings/plugins/[source] (history open)",
    session: "connections",
    open: async (page) => {
      await page.goto("/settings/plugins/enablebanking");
      await settled(page);
      for (const toggle of await page.getByRole("button", { name: /^(History|Cronologia)$/ }).all()) {
        await toggle.click();
      }
    },
  },
  {
    name: "/settings/plugins/advanced (log)",
    session: "connections",
    open: go("/settings/plugins/advanced"),
  },
  {
    name: "/accounts/[id] (from a connection)",
    session: "connections",
    open: async (page) => {
      await page.goto("/accounts");
      await settled(page);
      await page
        .getByRole("link", { name: /Alfa Bank current account/ })
        .first()
        .click();
      await expect(page.getByTestId("connection-status")).toBeVisible();
      await settled(page);
    },
  },
  {
    name: "/settings/plugins (admin)",
    session: "admin",
    open: go("/settings/plugins"),
  },
  // H56 (PERS-615, PERS-619): the list and a page in each state of the plugins' section.
  { name: "/settings/plugins (needs cleanup)", session: "pluginsCleanup", open: go("/settings/plugins") },
  {
    name: "/settings/plugins/[source] (needs cleanup)",
    session: "pluginsCleanup",
    open: go("/settings/plugins/wallet"),
  },
  { name: "/settings/plugins (never on)", session: "pluginsOff", open: go("/settings/plugins") },
  {
    name: "/settings/plugins/[source] (not active)",
    session: "pluginsGone",
    open: go("/settings/plugins/trek"),
  },
  {
    name: "/settings/plugins/[source] (error)",
    session: "pluginsErrors",
    open: go("/settings/plugins/wallet"),
  },
  { name: "/settings/plugins (every health)", session: "pluginsLive", open: go("/settings/plugins") },
  {
    name: "/settings/plugins/[source] (not connected)",
    session: "pluginsOn",
    open: go("/settings/plugins/enablebanking"),
  },
];

const OVERLAYS: Screen[] = [
  {
    // H56: «Deactivate» from the menu «⋯» of a row, with the counts of «Needs cleanup».
    name: "the deactivate dialog of «Needs cleanup»",
    session: "pluginsCleanup",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await page.goto("/settings/plugins");
      await settled(page);
      await page.getByRole("button", { name: /^(More actions for|Altre azioni per) Wallet$/ }).click();
      await page.getByRole("menuitem", { name: /^(Deactivate|Disattiva)…$/ }).click();
      await settledDialog(page);
    },
  },
  {
    // H56, PERS-615 §5: the refusal with its cause. The reading runs: nothing changes.
    name: "the refusal of «Deactivate»",
    session: "pluginsLive",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await page.goto("/settings/plugins/enablebanking");
      await settled(page);
      await page.getByRole("button", { name: /^(Deactivate|Disattiva) Enable Banking$/ }).click();
      await settledDialog(page);
      await page
        .getByRole("dialog")
        .getByRole("button", { name: /^(Deactivate|Disattiva) Enable Banking$/ })
        .click();
      await page.getByTestId("deactivate-refusal").waitFor();
      await settledDialog(page);
    },
  },
  {
    // Release N7.3 (plugin-settings.md §3.3): «Deactivate» with its counts, on the six banks.
    name: "the turn-off dialog",
    session: "connections",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await page.goto("/settings/plugins/enablebanking");
      await settled(page);
      await page.getByRole("button", { name: /^(Deactivate|Disattiva) Enable Banking$/ }).click();
      await settledDialog(page);
    },
  },
  {
    // Release N1: the credentials of the bank plugin, on the layout user (plugin on, nothing saved).
    name: "the bank credentials dialog",
    session: "layout",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await page.goto("/settings/plugins/enablebanking");
      await settled(page);
      await page.getByRole("button", { name: /Enter credentials|Inserisci credenziali/ }).click();
      await settledDialog(page);
    },
  },
  {
    // The sync schedule of the layout user's Trek link (seeded on manual only).
    name: "the sync schedule dialog",
    session: "layout",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      // From release N7.2 the schedule is on the source's page (plugin-settings.md §2.2).
      await page.goto("/settings/plugins/trek");
      await settled(page);
      // The rows are in order of name; every seeded link of this user is on manual only.
      await page
        .getByRole("button", { name: /Change the sync schedule|Cambia l'orario di sincronizzazione/ })
        .first()
        .click();
      await settledDialog(page);
    },
  },
  {
    // The same dialog with something in it: a preset, a second rule in cron, and the preview.
    name: "the sync schedule dialog, with rules",
    session: "layout",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      // From release N7.2 the schedule is on the source's page (plugin-settings.md §2.2).
      await page.goto("/settings/plugins/trek");
      await settled(page);
      // The rows are in order of name; every seeded link of this user is on manual only.
      await page
        .getByRole("button", { name: /Change the sync schedule|Cambia l'orario di sincronizzazione/ })
        .first()
        .click();
      await settledDialog(page);
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("radio", { name: /Custom rules|Regole personalizzate/ }).check();
      await dialog.getByRole("button", { name: /Add a rule|Aggiungi una regola/ }).click();
      await dialog.getByRole("button", { name: /Add a rule|Aggiungi una regola/ }).click();
      await dialog.getByRole("button", { name: /Add a rule|Aggiungi una regola/ }).click();
      await dialog.getByLabel(/Kind of rule 3|Tipo della regola 3/).selectOption("cron");
      await dialog
        .getByLabel(/Days$|Giorni$/)
        .nth(1)
        .selectOption("monthDays");
    },
  },
];

test.describe("every screen", () => audit(PAGES));
test.describe("every overlay", () => audit(OVERLAYS));
