// tests/e2e/payroll/a11y.spec.ts — the screens of the flow `payroll` in the layout and
// accessibility check: what is measured, and why, is in tests/e2e/_shared/a11y.ts.
import { test } from "@playwright/test";
import { audit, followLink, go, type Screen, settled, settledDialog } from "../_shared/a11y";
import { LAST_YEAR, TODAY } from "../_shared/helpers";

// The layout's payslips are last year's; the one typed by hand is of last month.
const PAYSLIPS = `/payroll?year=${LAST_YEAR}`;
const LAST_MONTH_YEAR = TODAY.slice(5, 7) === "01" ? LAST_YEAR : LAST_YEAR + 1;

const PAGES: Screen[] = [
  { name: "/payroll", session: "layout", smoke: true, open: go("/payroll") },
  { name: "/payroll?year=", session: "layout", open: go(PAYSLIPS) },
  {
    name: "/payroll/[id]",
    session: "layout",
    open: async (page) => {
      await page.goto(PAYSLIPS);
      await settled(page);
      // Not `…/original`, which is the stored PDF and starts a download rather than a page.
      await followLink(page, 'main a[href^="/payroll/"]:not([href$="/original"]):not([href$="/settings"])');
    },
  },
  { name: "/payroll/settings", session: "layout", open: go("/payroll/settings") },
  // R5g: a payslip typed by hand opens its own page.
  {
    name: "/payroll/manual/[id]",
    session: "payrollHand",
    open: async (page) => {
      await page.goto(`/payroll?year=${LAST_MONTH_YEAR}`);
      await settled(page);
      await followLink(page, 'main a[href^="/payroll/manual/"]');
    },
  },
];

const OVERLAYS: Screen[] = [
  {
    name: "the rename payslip dialog",
    session: "layout",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await page.goto(PAYSLIPS);
      await settled(page);
      await followLink(page, 'main a[href^="/payroll/"]:not([href$="/original"]):not([href$="/settings"])');
      await page.getByRole("button", { name: /^(Rename|Rinomina)$/ }).click();
      await settledDialog(page);
    },
  },
  {
    name: "the add payslips dialog, with its files",
    session: "layout",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await page.goto("/payroll");
      await settled(page);
      await page.getByRole("button", { name: /^(Add payslip|Aggiungi cedolino)$/ }).first().click();
      await settledDialog(page);
      await page.locator('[role="dialog"] input[type="file"]').setInputFiles([
        { name: "payslip.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-") },
      ]);
    },
  },
  {
    name: "the type a payslip dialog",
    session: "layout",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await page.goto("/payroll");
      await settled(page);
      await page.getByRole("button", { name: /^(Type a payslip|Inserisci a mano)$/ }).first().click();
      await settledDialog(page);
    },
  },
];

test.describe("every screen", () => audit(PAGES));
test.describe("every overlay", () => audit(OVERLAYS));
