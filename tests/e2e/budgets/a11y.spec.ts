// tests/e2e/budgets/a11y.spec.ts — the screens of the flow `budgets` in the layout and
// accessibility check: what is measured, and why, is in tests/e2e/_shared/a11y.ts.
import { test } from "@playwright/test";
import { audit, follow, go, type Screen } from "../_shared/a11y";

const PAGES: Screen[] = [
  { name: "/budgets", session: "layout", smoke: true, open: go("/budgets") },
  {
    name: "/budgets/[id]",
    session: "layout",
    open: (page) => follow(page, "/budgets", "Spesa"),
  },
];

test.describe("every screen", () => audit(PAGES));
