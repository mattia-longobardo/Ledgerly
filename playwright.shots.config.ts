// playwright.shots.config.ts — `npm run docs:shots`, the screenshots in the README.
//
// Its own config and not a spec of the end-to-end suite: those run on every check and would
// rewrite committed images each time, so the working tree would never be clean. This one is asked
// for by hand, when a screen has changed enough that its picture lies.
//
// It reuses the end-to-end seed, so every shot is of the `layout` user — invented accounts,
// invented payslips, an invented pension fund. **No screenshot in this repository ever shows a
// real person's money**, and the user it shows is deleted when the run ends.
import { defineConfig, devices } from "@playwright/test";
import { BASE_URL } from "./tests/e2e/env";

export default defineConfig({
  testDir: "./tests/shots",
  outputDir: "./test-results",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  use: {
    baseURL: BASE_URL,
    locale: "en-US",
    timezoneId: "Europe/Rome",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    // 1×: these are committed, and a 2× shot of a 1440 px page is four times the bytes for a
    // detail a README never shows.
    deviceScaleFactor: 1,
  },
});
