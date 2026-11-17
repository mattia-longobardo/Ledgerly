// tests/e2e/payroll/a11y.spec.ts — the screens of the flow `payroll` in the layout and
// accessibility check: what is measured, and why, is in tests/e2e/_shared/a11y.ts.
import { test } from "@playwright/test";
import { audit, followLink, go, type Screen, settled, settledDialog } from "../_shared/a11y";

const PAGES: Screen[] = [
  { name: "/payroll", session: "layout", smoke: true, open: go("/payroll") },
  {
    name: "/payroll/[id]",
    session: "layout",
    open: async (page) => {
      await page.goto("/payroll");
      await settled(page);
      // Not `…/original`, which is the stored PDF and starts a download rather than a page.
      await followLink(page, 'main a[href^="/payroll/"]:not([href$="/original"]):not([href$="/settings"])');
    },
  },
  { name: "/payroll/settings", session: "layout", open: go("/payroll/settings") },
];

const OVERLAYS: Screen[] = [
  {
    name: "the rename payslip dialog",
    session: "layout",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await page.goto("/payroll");
      await settled(page);
      await followLink(page, 'main a[href^="/payroll/"]:not([href$="/original"]):not([href$="/settings"])');
      await page.getByRole("button", { name: /^(Rename|Rinomina)$/ }).click();
      await settledDialog(page);
    },
  },
];

test.describe("every screen", () => audit(PAGES));
test.describe("every overlay", () => audit(OVERLAYS));
