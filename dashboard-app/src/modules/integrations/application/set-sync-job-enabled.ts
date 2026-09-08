import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import type { ProviderCode, SyncKind } from "@/platform/integrations/types";
import type { IntegrationDeps } from "./deps";
import { InvalidInputError, UnknownProviderError } from "./errors";
import type { SyncJob } from "./ports";

/**
 * Switches one (connection, kind) on or off without disconnecting the provider
 * (Ruling P2-C4). An off job is skipped by the scheduler and refuses a webhook
 * delivery for that kind (`SyncDisabledError` in `handleWebhook`); the cursor
 * stays put, so switching it back on resumes rather than re-imports.
 *
 * A provider that is not connected has no `sync_jobs` rows to toggle — they are
 * created on connect — so this is refused as bad input rather than answered
 * with a 404 that would read as "no such kind".
 */
export function setSyncJobEnabled(deps: IntegrationDeps) {
  return async (
    principal: Principal,
    provider: string,
    kind: string,
    enabled: boolean,
  ): Promise<SyncJob> => {
    assertPermission(principal, "integrations.manage");
    const adapter = deps.registry.get(provider);
    if (!adapter) throw new UnknownProviderError(`No such provider: ${provider}`);
    if (!(kind in adapter.syncs)) {
      throw new InvalidInputError(`${adapter.label} has no "${kind}" sync`);
    }

    return deps.inUserContext(principal.userId, async (d) => {
      const connection = await d.connections.getByProvider(principal.userId, adapter.code as ProviderCode);
      if (!connection || connection.status !== "connected") {
        throw new InvalidInputError(`${adapter.label} is not connected, so its syncs cannot be switched on or off`);
      }
      const job = await d.jobs.find(connection.id, kind as SyncKind);
      if (!job) throw new InvalidInputError(`${adapter.label} has no "${kind}" sync job to switch`);
      if (job.enabled === enabled) return job;

      const updated = await d.jobs.setEnabled(job.id, enabled);
      if (!updated) throw new InvalidInputError(`${adapter.label} has no "${kind}" sync job to switch`);
      await d.audit({
        actorUserId: principal.userId,
        action: enabled ? "integration.sync_job_enabled" : "integration.sync_job_disabled",
        entityType: "sync_job",
        entityId: updated.id,
        before: { enabled: job.enabled },
        after: { enabled: updated.enabled },
      });
      return updated;
    });
  };
}
