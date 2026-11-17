// tests/e2e/admin/a11y.spec.ts — the screens of the flow `admin` in the layout and
// accessibility check: what is measured, and why, is in tests/e2e/_shared/a11y.ts.
import { test } from "@playwright/test";
import { audit, go, type Screen } from "../_shared/a11y";

const PAGES: Screen[] = [
  { name: "/settings/data", session: "layout", open: go("/settings/data") },

  // Admin. For anybody else Users and Server answer 404, which is the point of them; Integrations
  // answers for everybody but shows the jobs card only here — the page F8 broke and F9 found.
  { name: "/settings/users (admin)", session: "admin", open: go("/settings/users") },
  { name: "/settings/server (admin)", session: "admin", open: go("/settings/server") },
];

test.describe("every screen", () => audit(PAGES));
