import { describe, expect, it } from "vitest";
import { resolveCapabilities } from "./resolve";
import { testPrincipal } from "@/test/principal";

const probes = (o: Partial<{ wallet: boolean; trek: boolean; payroll: boolean }>) => ({
  walletConfigured: () => o.wallet ?? false,
  trekConfigured: () => o.trek ?? false,
  payrollConfigured: () => o.payroll ?? false,
  hasAccounts: async (_userId: string) => true,
  hasPayrollRecords: async (_userId: string) => false,
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
