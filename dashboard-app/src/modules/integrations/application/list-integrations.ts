import { assertPermission, type Principal } from "@/platform/auth/principal";
import type {
  CredentialField,
  IntegrationCapability,
  IntegrationConnection,
  ProviderCode,
  SyncRun,
} from "@/platform/integrations/types";
import type { IntegrationDeps } from "./deps";

export interface IntegrationSummary {
  provider: ProviderCode;
  label: string;
  capabilities: readonly IntegrationCapability[];
  credentialFields: readonly CredentialField[];
  connection: IntegrationConnection | null;
  recentRuns: SyncRun[];
}

/**
 * Every registered provider, whether connected or not — Settings › Integrations
 * has to offer the ones that are missing, so an unconnected provider is a row
 * with a null connection rather than an absent row.
 */
export function listIntegrations(deps: IntegrationDeps) {
  return async (principal: Principal): Promise<IntegrationSummary[]> => {
    assertPermission(principal, "accounts.read");
    return deps.inUserContext(principal.userId, async (d) => {
      const connections = await d.connections.list(principal.userId);
      const byProvider = new Map(connections.map((c) => [c.provider, c]));

      return Promise.all(
        d.registry.list().map(async (provider) => {
          const connection = byProvider.get(provider.code) ?? null;
          return {
            provider: provider.code,
            label: provider.label,
            capabilities: provider.capabilities,
            credentialFields: provider.credentialFields,
            connection,
            recentRuns: connection ? await d.runs.recent(connection.id, 10) : [],
          };
        }),
      );
    });
  };
}
