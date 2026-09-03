import type { Principal } from "@/platform/auth/principal";
import type { Permission } from "@/platform/auth/permissions";

export type IntegrationState = "connected" | "error" | "disconnected" | "not_configured";

export interface Capabilities {
  features: {
    accounts: boolean;
    funds: boolean;
    budgets: boolean;
    expenses: boolean;
    interests: boolean;
    payroll: boolean;
    timeoff: boolean;
  };
  integrations: { wallet: IntegrationState; trek: IntegrationState; payroll: IntegrationState };
  permissions: ReadonlySet<Permission>;
  data: { hasAccounts: boolean; hasPayrollRecords: boolean };
}

export interface CapabilityProbes {
  walletConfigured(): boolean;
  trekConfigured(): boolean;
  payrollConfigured(): boolean;
  /** Both take the principal's id: `accounts` is behind RLS, so the count only means something inside that user's context. */
  hasAccounts(userId: string): Promise<boolean>;
  hasPayrollRecords(userId: string): Promise<boolean>;
}

/**
 * What this deployment can actually do, resolved once per request and handed to
 * whoever needs to decide whether a section exists at all.
 *
 * Two different questions live here on purpose. `features` answers "should this
 * section be reachable" — accounts, funds and budgets are hand-entered, so they
 * are on everywhere; expenses and interests only mean something once the wallet
 * is wired up. `integrations` answers "what is the state of the wire", which the
 * Settings page reports even when the matching feature is off. `data` is the
 * emptiness signal: a section can exist and still have nothing in it, and the
 * two must not be conflated — hiding a section because it is empty leaves the
 * user with no way to fill it.
 *
 * Probes are injected rather than imported so this module stays free of `@/lib/db`
 * and `node:fs`: it is pure, and its tests need no database and no environment.
 */
export async function resolveCapabilities(principal: Principal, probes: CapabilityProbes): Promise<Capabilities> {
  const wallet: IntegrationState = probes.walletConfigured() ? "connected" : "not_configured";
  const trek: IntegrationState = probes.trekConfigured() ? "connected" : "not_configured";
  const payroll: IntegrationState = probes.payrollConfigured() ? "connected" : "not_configured";
  const [hasAccounts, hasPayrollRecords] = await Promise.all([
    probes.hasAccounts(principal.userId),
    probes.hasPayrollRecords(principal.userId),
  ]);
  return {
    features: {
      accounts: true,
      funds: true,
      budgets: true,
      expenses: wallet === "connected",
      interests: wallet === "connected",
      payroll: payroll === "connected",
      timeoff: payroll === "connected" || trek === "connected",
    },
    integrations: { wallet, trek, payroll },
    permissions: principal.permissions,
    data: { hasAccounts, hasPayrollRecords },
  };
}
