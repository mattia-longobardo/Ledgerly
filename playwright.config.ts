// playwright.config.ts — the e2e suite drives the deployed site (tests/e2e/env.ts): deploy first.
import { defineConfig, devices } from "@playwright/test";
import { BASE_URL } from "./tests/e2e/env";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "en-US",
    timezoneId: "Europe/Rome",
    // HTTP/2 over TCP, not HTTP/3 (PERS-120): Chrome moves to QUIC once Cloudflare advertises it, and
    // from this host a QUIC request is sometimes lost — it never reaches Traefik and is never
    // retried, so a Server Action or a navigation hangs and a random step of a spec times out.
    launchOptions: { args: ["--disable-quic"] },
  },
  projects: [
    {
      name: "desktop",
      testIgnore: /mobile\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile",
      testMatch: /mobile\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 400, height: 860 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
