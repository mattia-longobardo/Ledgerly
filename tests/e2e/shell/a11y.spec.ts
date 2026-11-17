// tests/e2e/shell/a11y.spec.ts — the screens of the flow `shell` in the layout and
// accessibility check: what is measured, and why, is in tests/e2e/_shared/a11y.ts.
import { test } from "@playwright/test";
import { audit, go, type Screen, settled, settledDialog } from "../_shared/a11y";

const PAGES: Screen[] = [
  { name: "/privacy", session: null, open: go("/privacy") },
  { name: "/terms", session: null, open: go("/terms?lang=it") },
];

const OVERLAYS: Screen[] = [
  {
    name: "the command palette",
    session: "layout",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await page.goto("/");
      await settled(page);
      await page.keyboard.press("Control+k");
      await settledDialog(page);
    },
  },
  {
    name: "the mobile navigation bar",
    session: "layout",
    only: "phone",
    roots: ['nav[class*="fixed"]'],
    open: async (page) => {
      await page.goto("/");
      await settled(page);
    },
  },
  {
    name: "the mobile More sheet",
    session: "layout",
    only: "phone",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await page.goto("/");
      await settled(page);
      await page.getByRole("button", { name: /More|Altro/ }).click();
      await settledDialog(page);
    },
  },
];

test.describe("every screen", () => audit(PAGES));
test.describe("every overlay", () => audit(OVERLAYS));
