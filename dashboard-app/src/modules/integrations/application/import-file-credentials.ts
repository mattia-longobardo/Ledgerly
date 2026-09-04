import type { Principal } from "@/platform/auth/principal";
import type { ProviderCode } from "@/platform/integrations/types";
import { connectIntegration } from "./connect-integration";
import type { IntegrationDeps } from "./deps";

export interface FileCredentials {
  wallet?: { token: string };
  trek?: { baseUrl: string; token: string };
}

export interface ImportResult {
  imported: ProviderCode[];
  skipped: { provider: ProviderCode; reason: string }[];
}

/**
 * The one-time migration from the two mounted token files to the encrypted
 * vault (spec §6, §12).
 *
 * Idempotent on purpose: a provider that already holds a credential is skipped
 * rather than overwritten, so re-running after a half-finished deploy step
 * cannot replace a token the owner has since rotated from the UI.
 */
export function importFileCredentials(deps: IntegrationDeps) {
  return async (principal: Principal, files: FileCredentials): Promise<ImportResult> => {
    const result: ImportResult = { imported: [], skipped: [] };
    const entries: [ProviderCode, Record<string, string> | undefined][] = [
      ["wallet", files.wallet],
      ["trek", files.trek],
    ];

    for (const [provider, credentials] of entries) {
      if (!credentials) {
        result.skipped.push({ provider, reason: "no_file" });
        continue;
      }
      const existing = await deps.connections.getByProvider(principal.userId, provider);
      if (existing && (await deps.connections.readCredentials(principal.userId, existing.id))) {
        result.skipped.push({ provider, reason: "already_connected" });
        continue;
      }
      await connectIntegration(deps)(principal, { provider, credentials });
      result.imported.push(provider);
    }

    await deps.audit({
      actorUserId: principal.userId,
      action: "integration.import_file_credentials",
      entityType: "integration_connection",
      after: { imported: result.imported, skipped: result.skipped },
    });
    return result;
  };
}
