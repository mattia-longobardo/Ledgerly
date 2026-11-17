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
  { name: "/investments/catalog", session: "layout", open: go("/investments/catalog") },
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
    name: "the add manual account dialog",
    session: "layout",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await page.goto("/investments/catalog");
      await settled(page);
      await page.getByRole("button", { name: "Add manual account" }).first().click();
      await settledDialog(page);
    },
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
      await page.goto("/investments/catalog");
      await settled(page);
      await page.getByRole("button", { name: "Connect", exact: true }).first().click();
      await settledDialog(page);
    },
  },
  {
    name: "the connect Binance dialog",
    session: "admin",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await page.goto("/investments/catalog");
      await settled(page);
      await page
        .getByTestId("catalog-card")
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
