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
      try {
        const run = await resumeQueuedSync(deps)(
          connection.userId,
          { provider: connection.provider, kind: row.kind, trigger: row.trigger },
          row.id,
        );
        if (run) done.push(run);
      } catch (err) {
        // `resolve()`/`prepare()` inside `resumeQueuedSync` can throw before
        // `execute()`'s own try/catch ever takes over — an unknown provider, an
        // unimplemented kind, a connection that moved to `error`/`disabled` after
        // being queued, a job disabled between enqueue and drain. None of those
        // self-heal, and the row must not stay `queued`: left alone it would be
        // picked first again next tick, forever, and — because the whole batch is
        // fetched up front and this loop has one promise chain — it would also
        // kill every row after it in this tick, including other connections'.
        // Finishing it here is what keeps the doc comment above true.
        const error = err instanceof Error ? err.message : String(err);
        // This bookkeeping write is itself just another database write, and
        // it can fail the same way the one `execute()` guards against can:
        // if it throws here, unwrapped, the exception escapes this catch
        // block and kills the rest of the tick — the exact failure mode this
        // whole catch exists to prevent, one layer deeper. Swallowing it
        // leaves `row` `queued`; the next tick will pick it up and try again,
        // which is strictly better than losing every row after it in this one.
        try {
          const failed = await deps.inSystemContext(async (d) => {
            const finishedAt = d.clock.now();
            await d.runs.finish(row.id, { status: "failed", stats: {}, error, finishedAt });
            return { ...row, status: "failed" as const, error, finishedAt };
          });
          done.push(failed);
        } catch {
          // Not recorded in `done`: there is nothing accurate to report — the
          // write that would have produced it is exactly what failed.
        }
      }
    }

    return done;
  };
}
