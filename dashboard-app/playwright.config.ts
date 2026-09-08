import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end configuration. Two environment variables drive it, both read
 * here rather than deep in a spec so `npx playwright test --list` and this
 * file alone tell an operator what a run needs:
 *
 * - `E2E_BASE_URL` — the running instance to drive, default
 *   `http://localhost:3000`. There is deliberately no `webServer`: the app
 *   needs a database and a full environment (`src/lib/env.ts`), so the server
 *   is started by hand or by the deployment being smoke-tested, and these
 *   specs never own its lifecycle.
 * - `E2E_TOKEN` — a personal access token (`pat_….…`). Without it
 *   `smoke-api.spec.ts` skips with a message saying how to mint one; the
 *   unauthenticated specs (`smoke.spec.ts`, `settings.spec.ts`) always run.
 *   See `tests/e2e/README.md`.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // One worker, and no parallelism: the API smoke writes real rows and shares
  // one per-principal rate window with every other spec in the run.
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    // The API smoke has no device dimension — it never opens a page — so it
    // runs once, under `desktop`, instead of writing its rows twice.
    { name: "mobile", testIgnore: /smoke-api\.spec\.ts/, use: { ...devices["Pixel 7"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
});
