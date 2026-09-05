/**
 * The environment every integration test runs under.
 *
 * Loaded as vitest `setupFiles`, so it executes before the test file — and
 * therefore before any module in the graph calls `env()`. `resetEnvCache()`
 * runs after the assignment for the case where a setup file in the same worker
 * has already resolved the environment.
 *
 * `TEST_DATABASE_URL` is deliberately NOT set here: the vitest config already
 * supplies it, and `src/test/db.ts` refuses to run without it.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetEnvCache } from "@/lib/env";

const KEY = `itest:${Buffer.alloc(32, 11).toString("base64")}`;

Object.assign(process.env, {
  NODE_ENV: "test",
  TZ: "Europe/Rome",
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://app_test@localhost:55432/dashboard_test",
  AUTH_URL: "https://dash.example.test",
  AUTH_SECRET: "a".repeat(40),
  OIDC_ISSUER: "https://auth.example.test/application/o/dashboard/",
  OIDC_CLIENT_ID: "client",
  OIDC_CLIENT_SECRET: "secret",
  AUTHORIZED_SUB: "sub-123",
  CRON_SECRET: "c".repeat(20),
  WEBHOOK_SECRET: "w".repeat(20),
  WALLET_API_URL: "https://wallet.example.test/wallet/v1/api",
  DOCUMENT_STORE_DRIVER: "local",
  DOCUMENT_STORE_LOCAL_PATH: mkdtempSync(join(tmpdir(), "payroll-itest-")),
  // Every itest that seals a credential without building its own cipher opens
  // it again under this key. A test that wants its own key sets
  // `process.env.APP_ENCRYPTION_KEY` and calls `resetCredentialCipher()`.
  APP_ENCRYPTION_KEY: KEY,
});

resetEnvCache();

export { KEY as ITEST_ENCRYPTION_KEY };
