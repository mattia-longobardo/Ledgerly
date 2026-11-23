// tests/e2e/investments/a11y.spec.ts — the screens of the flow `investments` in the layout and
// accessibility check: what is measured, and why, is in tests/e2e/_shared/a11y.ts.
import { type Page, test } from "@playwright/test";
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
