// playwright.preview.config.ts — the e2e suite against a local preview (scripts/preview-on-test.sh),
// before a deploy. The users and the sessions come from `preview-on-test.sh seed`: this file has no
// global setup, because the suite's own seed writes next to the deployed site.
//
// Four workers, and the tests of a file side by side: the preview is one machine with one database
// of its own, and nobody else's. A file whose tests are one story on one user says so itself
// (`test.describe.configure({ mode: "serial" })`). The site keeps one worker (playwright.config.ts):
// it allows a client 5 password sign-ins a minute, and its users are shared with nothing here.
//
// Every test runs here, the ones tagged `@site` too: the preview is its own origin, and its seed
// has an exchange rate (docs/testing.md). `@site` now only names what runs again on the site.
import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

if (!process.env.E2E_BASE_URL) {
  throw new Error(
    "playwright.preview.config.ts needs E2E_BASE_URL (http://localhost:3999): see docs/testing.md",
  );
}

export default defineConfig({
  ...base,
  globalSetup: undefined,
  globalTeardown: undefined,
  fullyParallel: true,
  workers: 4,
});
