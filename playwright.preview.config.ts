// playwright.preview.config.ts — the e2e suite against a local preview (scripts/preview-on-test.sh),
// before a deploy. The users and the sessions come from `preview-on-test.sh seed`: this file has no
// global setup, because the suite's own seed writes next to the deployed site. A test tagged `@site`
// cannot pass here (the origin of a password sign-in, OAuth, the exchange rates, the plugin's
// return): it runs on the site after the deploy (docs/testing.md).
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
  grepInvert: /@site/,
});
