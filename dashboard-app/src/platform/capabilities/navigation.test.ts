import { describe, expect, it } from "vitest";
import { buildNavigation } from "./navigation";
import { resolveCapabilities } from "./resolve";
import { testPrincipal } from "@/test/principal";

const probes = {
  connectionStates: async (_userId: string) => ({
    wallet: "not_configured" as const,
    trek: "not_configured" as const,
    payroll_silo: "not_configured" as const,
  }),
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

  it("shows Expenses and Interests once Wallet is connected", async () => {
    const connected = buildNavigation(
      await resolveCapabilities(testPrincipal(), {
        ...probes,
        connectionStates: async () => ({ wallet: "connected", trek: "not_configured", payroll_silo: "not_configured" }),
      }),
    );
    expect(connected.find((i) => i.href === "/finance")!.children?.map((c) => c.label)).toEqual([
      "Overview",
      "Accounts",
      "Funds",
      "Expenses",
      "Budgets",
      "Interests",
      "Management",
    ]);
  });

  it("gives Settings its areas, Administration only for a principal with admin.users", async () => {
    const owner = buildNavigation(await resolveCapabilities(testPrincipal(), probes));
    const settings = owner.find((i) => i.href === "/settings")!;
    expect(settings.children?.map((c) => c.href)).toEqual([
      "/settings/personal",
      "/settings/security",
      "/settings/account",
      "/settings/integrations",
      "/settings/admin",
    ]);
    const member = buildNavigation(await resolveCapabilities(testPrincipal({ roles: ["member"] }), probes));
    expect(member.find((i) => i.href === "/settings")!.children).not.toContainEqual({
      href: "/settings/admin",
      label: "Administration",
    });
  });
});
