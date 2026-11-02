// tests/e2e/preview-env.ts — imported first by playwright.preview.config.ts, because `env.ts` reads
// these two when it loads, and imports run before the body of the file that asks for them.
process.env.E2E_BASE_URL ??= "http://localhost:3999";
process.env.E2E_FUNDS_HOME_PREVIEW ??= "1";
