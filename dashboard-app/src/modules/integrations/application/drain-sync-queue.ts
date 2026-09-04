import type { SyncRun } from "@/platform/integrations/types";
import type { IntegrationDeps } from "./deps";
import { resumeQueuedSync } from "./run-sync";

/**
 * Runs the syncs a webhook queued, each in its own connection owner's user
 * context.
 *
 * This is the half of Ruling P2-C3 that makes the webhook safe. The queue is
 * *read* in the system context — a tick has no principal, and a queued row may
 * belong to anybody — but nothing is *written* there: the connection's
 * `user_id` is looked up and the sync runs under it, so RLS applies to every
 * row the sync touches and the audit trail names the person, not the system.
 *
 * One failed run never stops the tick: the run row already records what went
 * wrong, and a queue that stalls on its first bad entry is a queue that never
 * drains again.
 */
export function drainSyncQueue(deps: IntegrationDeps) {
  return async (limit = 20): Promise<SyncRun[]> => {
    const queued = await deps.inSystemContext((d) => d.runs.queued(limit));
    const done: SyncRun[] = [];

    for (const row of queued) {
      const connection = await deps.inSystemContext((d) => d.connections.getById(row.connectionId));
      if (!connection) continue;
      const run = await resumeQueuedSync(deps)(
        connection.userId,
        { provider: connection.provider, kind: row.kind, trigger: row.trigger },
        row.id,
      );
      if (run) done.push(run);
    }

    return done;
  };
}
