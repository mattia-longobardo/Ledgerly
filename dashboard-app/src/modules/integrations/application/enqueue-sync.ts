import type {
  IntegrationConnection,
  SyncKind,
  SyncRun,
  SyncTrigger,
} from "@/platform/integrations/types";
import type { IntegrationDeps } from "./deps";
import { SyncDisabledError } from "./errors";

/**
 * Spec §3.4: an inbound webhook "enqueues a job row rather than doing work
 * inline" (Ruling P2-C3). This is that row.
 *
 * It runs in whatever context the caller already has open — the webhook route's
 * system context — because it writes nothing but a `sync_runs` row against a
 * connection the caller has just verified. The work itself is deliberately NOT
 * done here: a webhook request must not hold open a database transaction while
 * a provider is called back, and it must not run a user's sync under
 * `app.role = 'system'`.
 */
export function enqueueSync(deps: IntegrationDeps) {
  return async (
    connection: IntegrationConnection,
    kind: SyncKind,
    trigger: SyncTrigger,
  ): Promise<SyncRun> => {
    const job = await deps.jobs.find(connection.id, kind);
    if (job && !job.enabled) {
      throw new SyncDisabledError(`${connection.provider}'s ${kind} sync is switched off`);
    }
    return deps.runs.enqueue({
      connectionId: connection.id,
      jobId: job?.id ?? null,
      kind,
      trigger,
      queuedAt: deps.clock.now(),
    });
  };
}
