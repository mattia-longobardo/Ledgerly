import { afterEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { TEST_ENCRYPTION_KEY } from "@/test/encryption-key";
import { documentStoreConfigured, storeFromDriver } from "./document-store-resolver";

// `documentStoreConfigured()` reads `env()`, which validates the whole schema —
// this file runs isolated from other test files, so every required variable
// has to be present here too.
Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://dashboard:pw@localhost:5432/dashboard",
  AUTH_URL: "https://dashboard.example",
  AUTH_SECRET: "0123456789abcdef0123456789abcdef",
  OIDC_ISSUER: "https://auth.example/application/o/dashboard/",
  OIDC_CLIENT_ID: "dashboard",
  OIDC_CLIENT_SECRET: "client-secret",
  AUTHORIZED_SUB: "00000000-0000-0000-0000-000000000001",
  CRON_SECRET: "c".repeat(20),
  WEBHOOK_SECRET: "w".repeat(20),
  APP_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
});
const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
  resetEnvCache();
});

describe("storeFromDriver", () => {
  it("builds a local store from an explicit path", () => {
    const res = storeFromDriver({ driver: "local", localPath: "/tmp/payroll", nodeEnv: "development", credentials: null });
    expect(res?.driver).toBe("local");
    expect(res?.store.provider).toBe("local");
  });

  it("returns null for the local driver with no path — never a silently invented directory", () => {
    expect(storeFromDriver({ driver: "local", localPath: undefined, nodeEnv: "development", credentials: null })).toBeNull();
  });

  it("refuses the local driver in production (Ruling R4-16: the container is read-only)", () => {
    expect(() =>
      storeFromDriver({ driver: "local", localPath: "/tmp/payroll", nodeEnv: "production", credentials: null }),
    ).toThrow(/local document store is not usable in production/i);
  });

  it("builds a silo store from a complete credential", () => {
    const res = storeFromDriver({
      driver: "silo",
      localPath: undefined,
      nodeEnv: "production",
      credentials: {
        endpoint: "https://silo.internal",
        bucket: "payroll",
        region: "us-east-1",
        accessKeyId: "AK",
        secretAccessKey: "SK",
      },
    });
    expect(res?.driver).toBe("silo");
    expect(res?.store.provider).toBe("silo");
  });

  it("returns null for the silo driver with no connection — the setup state, not an error", () => {
    expect(storeFromDriver({ driver: "silo", localPath: undefined, nodeEnv: "production", credentials: null })).toBeNull();
  });
});

describe("documentStoreConfigured", () => {
  it("is false on a fresh deployment where DOCUMENT_STORE_DRIVER defaults to silo (Finding 1) — the silo case is answered upstream by the payroll_silo connection state, not by this probe", () => {
    delete process.env.DOCUMENT_STORE_DRIVER;
    delete process.env.DOCUMENT_STORE_LOCAL_PATH;
    resetEnvCache();
    expect(documentStoreConfigured()).toBe(false);
  });

  it("is false when the driver is explicitly silo, even with a stray local path set", () => {
    process.env.DOCUMENT_STORE_DRIVER = "silo";
    process.env.DOCUMENT_STORE_LOCAL_PATH = "/tmp/payroll";
    resetEnvCache();
    expect(documentStoreConfigured()).toBe(false);
  });

  it("is true only for the local driver with a local path configured", () => {
    process.env.DOCUMENT_STORE_DRIVER = "local";
    process.env.DOCUMENT_STORE_LOCAL_PATH = "/tmp/payroll";
    resetEnvCache();
    expect(documentStoreConfigured()).toBe(true);
  });

  it("is false for the local driver with no local path set", () => {
    process.env.DOCUMENT_STORE_DRIVER = "local";
    delete process.env.DOCUMENT_STORE_LOCAL_PATH;
    resetEnvCache();
    expect(documentStoreConfigured()).toBe(false);
  });
});
