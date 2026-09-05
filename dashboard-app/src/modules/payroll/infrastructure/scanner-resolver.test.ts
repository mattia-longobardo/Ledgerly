import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { TEST_ENCRYPTION_KEY } from "@/test/encryption-key";
import { resolveScanner } from "./scanner-resolver";

// `env()` validates the whole schema, so every required variable has to be
// present — this file runs isolated from src/lib/env.test.ts, which sets these
// for its own file only.
Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://dashboard:pw@localhost:5432/dashboard",
  AUTH_URL: "https://dashboard.example",
  AUTH_SECRET: "0123456789abcdef0123456789abcdef",
  OIDC_ISSUER: "https://auth.example/application/o/dashboard/",
  OIDC_CLIENT_ID: "dashboard",
  OIDC_CLIENT_SECRET: "client-secret",
  AUTHORIZED_SUB: "00000000-0000-0000-0000-000000000001",
  PAPERLESS_URL: "https://paperless.example",
  PAPERLESS_TOKEN: "paperless-token",
  CRON_SECRET: "c".repeat(20),
  WEBHOOK_SECRET: "w".repeat(20),
  APP_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
});

const saved = { ...process.env };

beforeEach(() => resetEnvCache());
afterEach(() => {
  process.env = { ...saved };
  resetEnvCache();
});

describe("resolveScanner", () => {
  it("returns the no-op scanner by default, which names itself none", async () => {
    delete process.env.MALWARE_SCANNER;
    resetEnvCache();
    expect(await resolveScanner().scan(new Uint8Array())).toEqual({
      verdict: "clean",
      scanner: "none",
      signature: null,
    });
  });

  it("returns a clamd scanner when asked for one", async () => {
    process.env.MALWARE_SCANNER = "clamd";
    process.env.CLAMD_HOST = "127.0.0.1";
    process.env.CLAMD_PORT = "1";
    resetEnvCache();
    // Nothing is listening on port 1, so the verdict proves it really is the
    // clamd adapter and not the no-op one wearing its name.
    expect(await resolveScanner().scan(new Uint8Array())).toMatchObject({ scanner: "clamd", verdict: "unavailable" });
  });
});
