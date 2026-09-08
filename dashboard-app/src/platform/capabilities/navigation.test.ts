import { describe, expect, it } from "vitest";
import { permissionsForRoles, type Permission } from "@/platform/auth/permissions";
import { testPrincipal } from "@/test/principal";
import { buildNavigation } from "./navigation";
import type { Capabilities } from "./resolve";
import { resolveCapabilities } from "./resolve";

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

/** Builds a `Capabilities` object directly, for tests that only care about
 * feature flags and permissions rather than the probes that would produce
 * them. */
function capsWith(
  overrides: { features?: Partial<Capabilities["features"]>; permissions?: ReadonlySet<Permission> } = {},
): Capabilities {
  return {
    features: {
      accounts: true,
      funds: true,
      budgets: true,
      expenses: false,
      interests: false,
      payroll: false,
      timeoff: false,
      ...overrides.features,
    },
    integrations: { wallet: "not_configured", trek: "not_configured", payroll: "not_configured" },
    // Defaults to read-only permissions, deliberately without `payroll.upload`
    // or `payroll.review`: Payroll's nav entry is gated on those permissions
    // alone (independent of the `payroll` feature — see navigation.ts), so a
    // default that already granted them would entangle every feature-only
    // scenario below with the permission gate. Tests that need Payroll's
    // permission grant it explicitly.
    permissions: overrides.permissions ?? permissionsForRoles(["viewer"]),
    data: { hasAccounts: false, hasPayrollRecords: false },
  };
}

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

  it("shows Company with its four children when payroll is on", () => {
    // Explicit owner permissions: Payroll's link needs `payroll.upload` or
    // `payroll.review`, which capsWith's default deliberately withholds (see
    // capsWith above) so it doesn't leak into the feature-only scenarios below.
    const items = buildNavigation(
      capsWith({ features: { payroll: true, timeoff: true }, permissions: permissionsForRoles(["owner"]) }),
    );
    const company = items.find((i) => i.href === "/company");
    expect(company).toMatchObject({ label: "Company", iconKey: "company" });
    expect(company!.children?.map((c) => c.href)).toEqual([
      "/company",
      "/company/earnings",
      "/company/time-off",
      "/company/payroll",
    ]);
  });

  it("shows only Time Off when Trek is connected but payroll is not", () => {
    const items = buildNavigation(capsWith({ features: { payroll: false, timeoff: true } }));
    const company = items.find((i) => i.href === "/company");
    expect(company!.children?.map((c) => c.href)).toEqual(["/company/time-off"]);
  });

  it("hides Company entirely when neither payroll nor time off is available", () => {
    const items = buildNavigation(capsWith({ features: { payroll: false, timeoff: false } }));
    expect(items.find((i) => i.href === "/company")).toBeUndefined();
  });

  it("hides Payroll from someone with neither upload nor review", () => {
    const items = buildNavigation(capsWith({ features: { payroll: true, timeoff: true }, permissions: new Set(["payroll.read"]) }));
    const company = items.find((i) => i.href === "/company");
    expect(company!.children?.map((c) => c.href)).not.toContain("/company/payroll");
  });

  it("no longer links to /work anywhere", () => {
    const items = buildNavigation(capsWith({ features: { payroll: true, timeoff: true } }));
    expect(JSON.stringify(items)).not.toContain("/work");
  });
});
