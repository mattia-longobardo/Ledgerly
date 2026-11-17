// tests/e2e/auth/a11y.spec.ts — the screens of the flow `auth` in the layout and
// accessibility check: what is measured, and why, is in tests/e2e/_shared/a11y.ts.
import { test } from "@playwright/test";
import { audit, go, type Screen } from "../_shared/a11y";

const PAGES: Screen[] = [
  { name: "/settings/profile", session: "layout", open: go("/settings/profile") },
  { name: "/settings/security", session: "layout", open: go("/settings/security") },

  // Signed out.
  { name: "/sign-in", session: null, smoke: true, open: go("/sign-in") },
  { name: "/forgot-password", session: null, open: go("/forgot-password") },
  { name: "/sign-in/two-factor", session: null, open: go("/sign-in/two-factor") },

  // TOTP setup (docs/auth-design.md D2): a seeded password user who has not set it up yet.
  { name: "/sign-in/two-factor/setup", session: "pending", open: go("/sign-in/two-factor/setup") },
];

test.describe("every screen", () => audit(PAGES));
