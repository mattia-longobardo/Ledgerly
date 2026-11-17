// tests/e2e/subscriptions/a11y.spec.ts — the screens of the flow `subscriptions` in the layout and
// accessibility check: what is measured, and why, is in tests/e2e/_shared/a11y.ts.
import { test } from "@playwright/test";
import { audit, go, type Screen } from "../_shared/a11y";

const PAGES: Screen[] = [{ name: "/subscriptions", session: "layout", open: go("/subscriptions") }];

test.describe("every screen", () => audit(PAGES));
