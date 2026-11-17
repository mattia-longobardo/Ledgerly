// tests/e2e/interests/a11y.spec.ts — the screens of the flow `interests` in the layout and
// accessibility check: what is measured, and why, is in tests/e2e/_shared/a11y.ts.
import { test } from "@playwright/test";
import { audit, follow, go, type Screen } from "../_shared/a11y";

const PAGES: Screen[] = [
  { name: "/interests", session: "layout", open: go("/interests") },
  {
    name: "/interests/[id]",
    session: "layout",
    open: (page) => follow(page, "/interests", "Revolut Saving"),
  },
];

test.describe("every screen", () => audit(PAGES));
