// tests/e2e/pockets/a11y.spec.ts — the screens of the flow `pockets` in the layout and
// accessibility check: what is measured, and why, is in tests/e2e/_shared/a11y.ts.
import { test } from "@playwright/test";
import { audit, follow, go, type Screen } from "../_shared/a11y";

const PAGES: Screen[] = [
  { name: "/pockets", session: "layout", open: go("/pockets") },
  {
    name: "/pockets/[id] (on an account)",
    session: "layout",
    open: (page) => follow(page, "/pockets", "Holidays"),
  },
  {
    name: "/pockets/[id] (standalone)",
    session: "layout",
    open: (page) => follow(page, "/pockets", "Gifts"),
  },
];

test.describe("every screen", () => audit(PAGES));
