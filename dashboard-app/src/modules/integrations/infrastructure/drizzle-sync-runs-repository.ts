import { and, asc, desc, eq } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { syncRuns, type SyncRunRow } from "@/lib/db/schema";
import type { SyncKind, SyncRun, SyncRunStatus, SyncTrigger } from "@/platform/integrations/types";
import type { NewSyncRun, SyncRunsRepository } from "../application/ports";

function toRun(row: SyncRunRow): SyncRun {
  return {
    id: row.id,
    connectionId: row.connectionId,
    jobId: row.jobId,
    kind: row.kind as SyncKind,
    status: row.status as SyncRunStatus,
    trigger: row.trigger as SyncTrigger,
    stats: (row.stats ?? {}) as Record<string, number>,
    error: row.error,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

export class DrizzleSyncRunsRepository implements SyncRunsRepository {
  constructor(private readonly db: DbClient) {}

  private async insert(input: NewSyncRun, status: "running" | "queued", at: Date): Promise<SyncRun> {
    const [row] = await this.db
      .insert(syncRuns)
      .values({
        connectionId: input.connectionId,
        jobId: input.jobId,
        kind: input.kind,
        status,
        trigger: input.trigger,
        startedAt: at,
      })
      .returning();
    return toRun(row!);
  }

  async start(input: NewSyncRun & { startedAt: Date }): Promise<SyncRun> {
    return this.insert(input, "running", input.startedAt);
  }

  /** Spec §3.4: the webhook leaves the work behind as a row, not as an open request. */
  async enqueue(input: NewSyncRun & { queuedAt: Date }): Promise<SyncRun> {
    return this.insert(input, "queued", input.queuedAt);
  }

  /**
   * The whole reason the drain is safe to run from more than one tick: the
   * `status = 'queued'` predicate is part of the UPDATE, so Postgres decides
   * the race and the loser gets no row back rather than a second execution.
   */
  async claim(id: string, startedAt: Date): Promise<SyncRun | null> {
    const [row] = await this.db
      .update(syncRuns)
      .set({ status: "running", startedAt })
      .where(and(eq(syncRuns.id, id), eq(syncRuns.status, "queued")))
      .returning();
    return row ? toRun(row) : null;
  }

  async finish(
    id: string,
    patch: { status: SyncRunStatus; stats: Record<string, number>; error: string | null; finishedAt: Date },
  ): Promise<void> {
    await this.db
      .update(syncRuns)
      .set({ status: patch.status, stats: patch.stats, error: patch.error, finishedAt: patch.finishedAt })
      .where(eq(syncRuns.id, id));
  }

  async running(connectionId: string, kind: SyncKind): Promise<SyncRun | null> {
    const [row] = await this.db
      .select()
      .from(syncRuns)
      .where(and(eq(syncRuns.connectionId, connectionId), eq(syncRuns.kind, kind), eq(syncRuns.status, "running")))
      .orderBy(desc(syncRuns.startedAt))
      .limit(1);
    return row ? toRun(row) : null;
  }

  async recent(connectionId: string, limit: number): Promise<SyncRun[]> {
    const rows = await this.db
      .select()
      .from(syncRuns)
      .where(eq(syncRuns.connectionId, connectionId))
      .orderBy(desc(syncRuns.startedAt))
      .limit(limit);
    return rows.map(toRun);
  }

  /** Oldest first, so a queue that briefly outruns the tick still drains in order. */
  async queued(limit: number): Promise<SyncRun[]> {
    const rows = await this.db
      .select()
      .from(syncRuns)
      .where(eq(syncRuns.status, "queued"))
      .orderBy(asc(syncRuns.startedAt))
      .limit(limit);
    return rows.map(toRun);
  }
}
