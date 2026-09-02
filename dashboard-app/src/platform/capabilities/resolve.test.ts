import { describe, expect, it } from "vitest";
import { resolveCapabilities } from "./resolve";
import { testPrincipal } from "@/test/principal";

const probes = (o: Partial<{ wallet: boolean; trek: boolean; payroll: boolean }>) => ({
  walletConfigured: () => o.wallet ?? false,
  trekConfigured: () => o.trek ?? false,
  payrollConfigured: () => o.payroll ?? false,
  hasAccounts: async () => true,
  hasPayrollRecords: async () => false,
});

describe("resolveCapabilities", () => {
  it("expenses and interests follow the wallet integration", async () => {
    const off = await resolveCapabilities(testPrincipal(), probes({}));
    expect(off.features.expenses).toBe(false);
    expect(off.integrations.wallet).toBe("not_configured");
    const on = await resolveCapabilities(testPrincipal(), probes({ wallet: true }));
    expect(on.features.expenses).toBe(true);
    expect(on.features.interests).toBe(true);
  });
  it("manual features are always on", async () => {
    const c = await resolveCapabilities(testPrincipal(), probes({}));
    expect(c.features).toMatchObject({ accounts: true, funds: true, budgets: true });
  });
});
