// playwright.preview.config.ts — the end-to-end specs against a local preview on `ledgerly_test`, for a
// screen on `main` that is not connected yet (docs/design/funds-ux.md §10). No global setup: the
// procedure seeds the test database itself, and the suite's own setup would seed the deployed site.
import "./tests/e2e/preview-env";
import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({ ...base, globalSetup: undefined, globalTeardown: undefined });
