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
      // RLS on `integration_connections` resolves only inside a transaction
      // that has set `app.user_id` — calling these two reads directly on
      // `deps` runs them on the bare pool, where the policy matches nothing
      // and `existing` is always null. Wrapping the check (not the write
      // below, which `connectIntegration` opens its own context around) is
      // what lets the skip branch see a real row.
      const alreadyConnected = await deps.inUserContext(principal.userId, async (d) => {
        const existing = await d.connections.getByProvider(principal.userId, provider);
        if (!existing) return false;
        return Boolean(await d.connections.readCredentials(principal.userId, existing.id));
      });
      if (alreadyConnected) {
        result.skipped.push({ provider, reason: "already_connected" });
        continue;
      }
      await connectIntegration(deps)(principal, { provider, credentials });
      result.imported.push(provider);
    }

    // Same reason as the read above: `audit_events` is FORCE RLS too, and its
    // WITH CHECK requires `app.user_id` to be set to the acting user.
    await deps.inUserContext(principal.userId, (d) =>
      d.audit({
        actorUserId: principal.userId,
        action: "integration.import_file_credentials",
        entityType: "integration_connection",
        after: { imported: result.imported, skipped: result.skipped },
      }),
    );
    return result;
  };
}
