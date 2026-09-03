import { describe, expect, it } from "vitest";
import { buildNavigation } from "./navigation";
import { resolveCapabilities } from "./resolve";
import { testPrincipal } from "@/test/principal";

const probes = {
  walletConfigured: () => false,
  trekConfigured: () => false,
  payrollConfigured: () => true,
  hasAccounts: async (_userId: string) => false,
  hasPayrollRecords: async (_userId: string) => false,
};

describe("buildNavigation", () => {
  it("hides Expenses and Interests without wallet and shows Management only with finance.manage", async () => {
    const owner = buildNavigation(await resolveCapabilities(testPrincipal(), probes));
    const finance = owner.find((i) => i.href === "/finance")!;
    expect(finance.children?.map((c) => c.label)).toEqual(["Overview", "Accounts", "Funds", "Budgets", "Management"]);
    const viewer = buildNavigation(await resolveCapabilities(testPrincipal({ roles: ["viewer"] }), probes));
    expect(viewer.find((i) => i.href === "/finance")!.children?.map((c) => c.label)).not.toContain("Management");
  });
});
