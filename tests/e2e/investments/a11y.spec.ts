// tests/e2e/investments/a11y.spec.ts — the screens of the flow `investments` in the layout and
// accessibility check: what is measured, and why, is in tests/e2e/_shared/a11y.ts.
import { expect, type Page, test } from "@playwright/test";
import {
  audit,
  follow,
  go,
  headerCommand,
  type Screen,
  serviceTab,
  settled,
  settledDialog,
} from "../_shared/a11y";
import { THIS_YEAR } from "../_shared/helpers";

const PAGES: Screen[] = [
  { name: "/investments", session: "layout", smoke: true, open: go("/investments") },
  {
    name: "/investments · All, the value chart, by class",
    session: "layout",
    open: go("/investments?preset=all&view=value&by=class"),
  },
  // The chart of the pension funds alone, as bars and as the value held from one reading to the next.
  {
    name: "/investments · Pension funds, the P&L chart",
    session: "layout",
    open: go("/investments?preset=all&group=pension_funds"),
  },
  {
    name: "/investments · Pension funds, the value chart",
    session: "layout",
    open: go("/investments?preset=all&group=pension_funds&view=value"),
  },
  // The tabs of a service (§3.2–§3.6, U3): the three of the two manual accounts, which keep no
  // positions (PERS-335), and the four of the two connected ones.
  ...(
    [
      ["Directa", "a manual account typed by hand", false],
      ["Fineco Conto Deposito", "a manual account Wallet reads", false],
      ["eToro", "synced with eToro", true],
      ["Binance", "synced with Binance", true],
    ] as const
  ).flatMap(([service, what, positions]) =>
    (positions
      ? (["", "positions", "activity", "connection"] as const)
      : (["", "activity", "connection"] as const)
    ).map((tab) => ({
      name: `/investments/[accountId]${tab ? `/${tab}` : ""}, ${what}`,
      session: "layout" as const,
      open: (page: Page) => serviceTab(page, service, tab),
    })),
  ),
  // A manual portfolio (R5d): its positions with their price mode, and its cash.
  ...(["", "positions", "activity"] as const).map((tab) => ({
    name: `/investments/[accountId]${tab ? `/${tab}` : ""}, a manual portfolio`,
    session: "portfolio" as const,
    open: (page: Page) => serviceTab(page, "Broker", tab),
  })),
  // The basket plans of a manual portfolio (PERS-681 §7): every state of a plan and of an execution,
  // and a portfolio with none.
  ...(["Piani", "Altri piani", "Senza liquidità", "Vuoto"] as const).map((portfolio) => ({
    name: `/investments/[accountId]/plans, ${portfolio}`,
    session: "plans" as const,
    open: (page: Page) => plansTab(page, portfolio),
  })),
  // The closed positions of Positions (§3.4, U4): in the period and ever, of a synced service.
  ...(["closed", "all"] as const).map((status) => ({
    name: `/investments/[accountId]/positions?status=${status}, synced with eToro`,
    session: "layout" as const,
    open: async (page: Page) => {
      await serviceTab(page, "eToro", "positions");
      const url = new URL(page.url());
      url.searchParams.set("period", "all");
      url.searchParams.set("status", status);
      await page.goto(url.toString());
      await settled(page);
    },
  })),
  {
    name: "/investments/[accountId]/positions?by=class, synced with eToro",
    session: "layout",
    open: async (page: Page) => {
      await serviceTab(page, "eToro", "positions");
      const url = new URL(page.url());
      url.searchParams.set("by", "class");
      await page.goto(url.toString());
      await settled(page);
    },
  },
];

/** «Add investment» on the home, and then one of its choices when named (rewrite plan R5b, B1c). */
/** The Plans tab of a manual portfolio (PERS-681). */
async function plansTab(page: Page, portfolio: string) {
  await follow(page, "/investments", new RegExp(`^${portfolio}$`));
  await page.goto(`${page.url().split("?")[0]}/plans`);
  await settled(page);
}

/** A command of a plan's `⋯` menu. */
async function planCommand(page: Page, command: string) {
  await plansTab(page, "Piani");
  await page.getByRole("button", { name: "Commands of Tre ETF" }).filter({ visible: true }).click();
  await page.getByRole("menuitem", { name: command, exact: true }).click();
  await settledDialog(page);
}

async function addInvestment(page: Page, choice?: RegExp) {
  await page.goto("/investments");
  await settled(page);
  await page.getByRole("button", { name: "Add investment" }).first().click();
  await settledDialog(page);
  if (!choice) return;
  await page.getByRole("dialog").getByRole("button", { name: choice }).click();
  await settledDialog(page);
}

const OVERLAYS: Screen[] = [
  {
    name: "the period picker of Investments",
    session: "layout",
    open: async (page) => {
      await page.goto(`/investments?from=${THIS_YEAR - 1}-01-01&to=${THIS_YEAR - 1}-06-30`);
      await settled(page);
      await page.locator('summary[title="Date range"]').click();
      await page.waitForTimeout(300);
    },
  },
  {
    name: "the add investment dialog",
    session: "layout",
    roots: ['[role="dialog"]'],
    open: async (page) => addInvestment(page),
  },
  {
    name: "the account with value only dialog",
    session: "layout",
    roots: ['[role="dialog"]'],
    open: async (page) => addInvestment(page, /^Account with value only/),
  },
  {
    name: "the manual portfolio dialog",
    session: "layout",
    roots: ['[role="dialog"]'],
    open: async (page) => addInvestment(page, /^Manual portfolio/),
  },
  {
    name: "the record operation dialog, a purchase with its instrument found",
    session: "portfolio",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await follow(page, "/investments", /^Broker$/);
      await page.getByRole("button", { name: "Record operation" }).click();
      await page.getByRole("searchbox", { name: "Instrument" }).fill("IE00BK5BQT80");
      await page.getByTestId("instrument-hit").first().click();
      await settledDialog(page);
    },
  },
  {
    name: "the record operation dialog, a sale",
    session: "portfolio",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await follow(page, "/investments", /^Broker$/);
      await page.getByRole("button", { name: "Record operation" }).click();
      await page.getByRole("dialog").getByLabel("Type").selectOption("sell");
      await settledDialog(page);
    },
  },
  {
    // PERS-651: a deposit's «From account», the other side of its leg in the account.
    name: "the record operation dialog, a deposit with its other side",
    session: "portfolio",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await follow(page, "/investments", /^Broker$/);
      await page.getByRole("button", { name: "Record operation" }).click();
      await page.getByRole("dialog").getByLabel("Type").selectOption("deposit");
      await settledDialog(page);
    },
  },
  {
    // PERS-693: «Edit» of an operation, the same form filled from the server.
    name: "the edit operation dialog",
    session: "editOps",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await serviceTab(page, "Broker", "activity");
      await page
        .getByRole("button", { name: /^Actions for the operation of / })
        .filter({ visible: true })
        .first()
        .click();
      await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
      await settledDialog(page);
    },
  },
  {
    name: "the switch to positions dialog",
    session: "portfolio",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await follow(page, "/investments", /^Titoli$/);
      await headerCommand(page, "More actions", "Switch to positions");
      await settledDialog(page);
    },
  },
  {
    name: "the new purchase plan dialog, with two instruments",
    session: "plans",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await plansTab(page, "Piani");
      await page.getByRole("button", { name: "New plan" }).click();
      for (const isin of ["XXE2EPLAN015", "XXE2EPLAN023"]) {
        await page.getByRole("searchbox", { name: "Instrument" }).fill(isin);
        await page.getByTestId("instrument-hit").first().click();
        await page.getByRole("button", { name: "Add instrument" }).click();
      }
      await settledDialog(page);
    },
  },
  {
    name: "the edit plan dialog",
    session: "plans",
    roots: ['[role="dialog"]'],
    open: (page) => planCommand(page, "Edit"),
  },
  // «Review the proposal» with a line skipped, and with a line whose price is to type.
  ...(["Due ETF", "Prezzo mancante"] as const).map((plan) => ({
    name: `the review proposal dialog, ${plan}`,
    session: "plans" as const,
    roots: ['[role="dialog"]'],
    open: async (page: Page) => {
      await plansTab(page, "Piani");
      await page
        .getByRole("link", { name: new RegExp(`^${plan}`) })
        .filter({ visible: true })
        .click();
      // The executions of the plan chosen, not of the one open before.
      await expect(page.getByRole("heading", { name: `Executions · ${plan}` })).toBeVisible();
      await page
        .getByRole("button", { name: /^Review the proposal of/ })
        .filter({ visible: true })
        .first()
        .click();
      await settledDialog(page);
    },
  })),
  {
    name: "the connect a service dialog",
    session: "admin",
    roots: ['[role="dialog"]'],
    open: async (page) => addInvestment(page, /^Connect a service/),
  },
  {
    name: "the update value dialog",
    session: "layout",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await follow(page, "/investments", /^Directa$/);
      await page.getByRole("button", { name: "Update value" }).first().click();
      await settledDialog(page);
    },
  },
  {
    name: "the connect eToro dialog",
    session: "admin",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await addInvestment(page, /^Connect a service/);
      await page.getByRole("button", { name: "Connect", exact: true }).first().click();
      await settledDialog(page);
    },
  },
  {
    name: "the connect Binance dialog",
    session: "admin",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await addInvestment(page, /^Connect a service/);
      await page
        .getByTestId("provider-row")
        .filter({ hasText: "Binance" })
        .getByRole("button", { name: "Connect", exact: true })
        .click();
      await settledDialog(page);
    },
  },
  {
    name: "the replace key dialog",
    session: "layout",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await follow(page, "/investments", /^eToro$/);
      await headerCommand(page, "More actions", "Replace key");
      await settledDialog(page);
    },
  },
  {
    name: "the disconnect dialog",
    session: "layout",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await serviceTab(page, "eToro", "connection");
      await page.getByRole("button", { name: "Disconnect", exact: true }).first().click();
      await settledDialog(page);
    },
  },
];

test.describe("every screen", () => audit(PAGES));
test.describe("every overlay", () => audit(OVERLAYS));
