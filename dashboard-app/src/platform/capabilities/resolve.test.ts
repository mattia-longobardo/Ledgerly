import { afterEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { documentStoreConfigured } from "@/modules/payroll/infrastructure/document-store-resolver";
import { TEST_ENCRYPTION_KEY } from "@/test/encryption-key";
import { resolveCapabilities } from "./resolve";
import type { IntegrationState } from "./resolve";
import { testPrincipal } from "@/test/principal";

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

const probes = (o: Partial<{ wallet: IntegrationState; trek: IntegrationState; payroll: boolean }>) => ({
  connectionStates: async (_userId: string) => ({
    wallet: o.wallet ?? ("not_configured" as IntegrationState),
    trek: o.trek ?? ("not_configured" as IntegrationState),
    payroll_silo: "not_configured" as IntegrationState,
  }),
  payrollConfigured: () => o.payroll ?? false,
  hasAccounts: async (_userId: string) => true,
  hasPayrollRecords: async (_userId: string) => false,
});

describe("resolveCapabilities", () => {
  it("expenses and interests follow the wallet integration", async () => {
    const off = await resolveCapabilities(testPrincipal(), probes({}));
    expect(off.features.expenses).toBe(false);
    expect(off.integrations.wallet).toBe("not_configured");
    const on = await resolveCapabilities(testPrincipal(), probes({ wallet: "connected" }));
    expect(on.features.expenses).toBe(true);
    expect(on.features.interests).toBe(true);
  });
  it("derives features from connection state, not from configuration files", async () => {
    const caps = await resolveCapabilities(testPrincipal(), probes({ wallet: "connected", trek: "error" }));
    expect(caps.integrations).toEqual({ wallet: "connected", trek: "error", payroll: "not_configured" });
    expect(caps.features.expenses).toBe(true);
    expect(caps.features.interests).toBe(true);
    // An integration in `error` is not a working integration.
    expect(caps.features.timeoff).toBe(false);
  });

  it("hides Expenses and Interests when Wallet is not connected", async () => {
    const caps = await resolveCapabilities(testPrincipal(), probes({}));
    expect(caps.features.expenses).toBe(false);
    expect(caps.features.interests).toBe(false);
  });
  it("asks the data probes about the signed-in principal", async () => {
    const seen: string[] = [];
    await resolveCapabilities(testPrincipal({ userId: "u-1" }), {
      ...probes({}),
      hasAccounts: async (userId: string) => {
        seen.push(userId);
        return true;
      },
      hasPayrollRecords: async (userId: string) => {
        seen.push(userId);
        return false;
      },
    });
    expect(seen).toEqual(["u-1", "u-1"]);
  });
  it("manual features are always on", async () => {
    const c = await resolveCapabilities(testPrincipal(), probes({}));
    expect(c.features).toMatchObject({ accounts: true, funds: true, budgets: true });
  });

  it("reports payroll from the silo connection, and falls back to the local-path probe", async () => {
    const base = {
      payrollConfigured: () => false,
      hasAccounts: async () => true,
      hasPayrollRecords: async () => false,
    };
    const connected = await resolveCapabilities(testPrincipal(), {
      ...base,
      connectionStates: async () => ({ wallet: "disconnected" as const, trek: "disconnected" as const, payroll_silo: "connected" as const }),
    });
    expect(connected.features.payroll).toBe(true);
    expect(connected.integrations.payroll).toBe("connected");

    const localOnly = await resolveCapabilities(testPrincipal(), {
      ...base,
      payrollConfigured: () => true,
      connectionStates: async () => ({ wallet: "disconnected" as const, trek: "disconnected" as const, payroll_silo: "not_configured" as const }),
    });
    expect(localOnly.features.payroll).toBe(true);

    const errored = await resolveCapabilities(testPrincipal(), {
      ...base,
      payrollConfigured: () => true,
      connectionStates: async () => ({ wallet: "disconnected" as const, trek: "disconnected" as const, payroll_silo: "error" as const }),
    });
    expect(errored.features.payroll).toBe(false);
    expect(errored.integrations.payroll).toBe("error");
  });

  it("does not grant the payroll feature on a fresh deployment with no store configured (Finding 1: DOCUMENT_STORE_DRIVER defaults to silo)", async () => {
    delete process.env.DOCUMENT_STORE_DRIVER;
    delete process.env.DOCUMENT_STORE_LOCAL_PATH;
    resetEnvCache();
    const caps = await resolveCapabilities(testPrincipal(), {
      // The real probe, not a stub — this is the exact wiring `realProbes` uses
      // in `probes.ts`, so it catches a regression in `documentStoreConfigured`
      // itself, not just in how `resolve.ts` combines the probe's answer.
      payrollConfigured: () => documentStoreConfigured(),
      connectionStates: async () => ({
        wallet: "disconnected" as const,
        trek: "disconnected" as const,
        payroll_silo: "not_configured" as const,
      }),
      hasAccounts: async () => true,
      hasPayrollRecords: async () => false,
    });
    expect(caps.features.payroll).toBe(false);
    expect(caps.integrations.payroll).toBe("not_configured");
  });
});
