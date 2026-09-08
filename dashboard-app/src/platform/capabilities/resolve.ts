import type { Principal } from "@/platform/auth/principal";
import type { Permission } from "@/platform/auth/permissions";
import type { ProviderCode } from "@/platform/integrations/types";

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
  /** Connection status per provider for this user, straight from integration_connections. */
  connectionStates(userId: string): Promise<Record<ProviderCode, IntegrationState>>;
  /** Whether a document store (silo or local path) is configured at all, independent of any connection. */
  payrollConfigured(): boolean;
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
 * is wired up. `integrations` reports the state of a stored connection rather
 * than the presence of a mounted file, which is why "wired up" and "configured"
 * have stopped being the same question — the Settings page reports it even
 * when the matching feature is off. `data` is the emptiness signal: a section
 * can exist and still have nothing in it, and the two must not be conflated —
 * hiding a section because it is empty leaves the user with no way to fill it.
 *
 * Probes are injected rather than imported so this module stays free of `@/lib/db`
 * and `node:fs`: it is pure, and its tests need no database and no environment.
 */
export async function resolveCapabilities(principal: Principal, probes: CapabilityProbes): Promise<Capabilities> {
  const [states, hasAccounts, hasPayrollRecords] = await Promise.all([
    probes.connectionStates(principal.userId),
    probes.hasAccounts(principal.userId),
    probes.hasPayrollRecords(principal.userId),
  ]);
  const wallet = states.wallet;
  const trek = states.trek;
  // Spec §6's feature matrix: the payroll feature needs a *store*, which is
  // either a connected `payroll_silo` integration or a configured local path.
  // A connection in `error` reports as `error` rather than being flattened into
  // "off" — the Settings page needs to say which, and a store that is present
  // but broken must not silently fall back to the local-path answer.
  const payroll: IntegrationState =
    states.payroll_silo !== "not_configured"
      ? states.payroll_silo
      : probes.payrollConfigured()
        ? "connected"
        : "not_configured";
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
