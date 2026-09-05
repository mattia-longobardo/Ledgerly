import { describe, expect, it } from "vitest";
import { resolveCapabilities } from "./resolve";
import type { IntegrationState } from "./resolve";
import { testPrincipal } from "@/test/principal";

const probes = (o: Partial<{ wallet: IntegrationState; trek: IntegrationState; payroll: boolean }>) => ({
  connectionStates: async (_userId: string) => ({
    wallet: o.wallet ?? ("not_configured" as IntegrationState),
    trek: o.trek ?? ("not_configured" as IntegrationState),
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
});
