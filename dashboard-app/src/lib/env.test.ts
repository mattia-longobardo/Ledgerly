import { describe, expect, it } from "vitest";
import { TEST_ENCRYPTION_KEY } from "@/test/encryption-key";
import { env, resetEnvCache } from "./env";

// `env()` validates the whole schema, so every required variable has to be present.
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
resetEnvCache();

describe("resetEnvCache", () => {
  it("makes the next env() call observe a variable changed after the first call", () => {
    process.env.CRON_SECRET = "x".repeat(20);
    resetEnvCache();
    expect(env().CRON_SECRET).toBe("x".repeat(20));

    // Without a reset, env() would keep returning the memoised "x" value.
    process.env.CRON_SECRET = "y".repeat(20);
    resetEnvCache();
    expect(env().CRON_SECRET).toBe("y".repeat(20));
  });
});

describe("DOCUMENT_STORE_DRIVER", () => {
  it("defaults the document store driver to silo and leaves the local path unset", () => {
    delete process.env.DOCUMENT_STORE_DRIVER;
    delete process.env.DOCUMENT_STORE_LOCAL_PATH;
    resetEnvCache();
    const parsed = env();
    expect(parsed.DOCUMENT_STORE_DRIVER).toBe("silo");
    expect(parsed.DOCUMENT_STORE_LOCAL_PATH).toBeUndefined();
  });
});

describe("MALWARE_SCANNER", () => {
  it("defaults the malware scanner to none, so the boundary is present and inert", () => {
    delete process.env.MALWARE_SCANNER;
    delete process.env.CLAMD_PORT;
    resetEnvCache();
    const parsed = env();
    expect(parsed.MALWARE_SCANNER).toBe("none");
    expect(parsed.CLAMD_PORT).toBe(3310);
  });
});
