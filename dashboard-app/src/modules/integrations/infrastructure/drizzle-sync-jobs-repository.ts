import { and, asc, eq } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { syncJobs, type SyncJobRow } from "@/lib/db/schema";
import type { SyncKind, SyncSchedule } from "@/platform/integrations/types";
import type { SyncJob, SyncJobsRepository } from "../application/ports";

function toJob(row: SyncJobRow): SyncJob {
  return {
    id: row.id,
    connectionId: row.connectionId,
    kind: row.kind as SyncKind,
    schedule: row.schedule as SyncSchedule,
    enabled: row.enabled,
    cursor: row.cursor,
  };
}

export class DrizzleSyncJobsRepository implements SyncJobsRepository {
  constructor(private readonly db: DbClient) {}

  /**
   * One row per (connection, kind), created on connect and never duplicated —
   * `ON CONFLICT DO NOTHING` against `sync_jobs_connection_kind_uq`, then a
   * read, so a reconnect keeps whatever `enabled` and `cursor` the existing
   * row has. Re-enabling a kind somebody switched off is not a side effect of
   * reconnecting.
   */
  async ensure(input: { connectionId: string; kind: SyncKind; schedule: SyncSchedule }): Promise<SyncJob> {
    await this.db
      .insert(syncJobs)
      .values({ connectionId: input.connectionId, kind: input.kind, schedule: input.schedule })
      .onConflictDoNothing({ target: [syncJobs.connectionId, syncJobs.kind] });
    const existing = await this.find(input.connectionId, input.kind);
    if (!existing) throw new Error(`sync_jobs row for ${input.connectionId}/${input.kind} did not persist`);
    return existing;
  }

  async find(connectionId: string, kind: SyncKind): Promise<SyncJob | null> {
    const [row] = await this.db
      .select()
      .from(syncJobs)
      .where(and(eq(syncJobs.connectionId, connectionId), eq(syncJobs.kind, kind)))
      .limit(1);
    return row ? toJob(row) : null;
  }

  async listForConnection(connectionId: string): Promise<SyncJob[]> {
    const rows = await this.db
      .select()
      .from(syncJobs)
      .where(eq(syncJobs.connectionId, connectionId))
      .orderBy(asc(syncJobs.kind));
    return rows.map(toJob);
  }

  async setCursor(id: string, cursor: unknown): Promise<void> {
    await this.db
      .update(syncJobs)
      .set({ cursor: cursor ?? null, updatedAt: new Date() })
      .where(eq(syncJobs.id, id));
  }

  async setEnabled(id: string, enabled: boolean): Promise<SyncJob | null> {
    const [row] = await this.db
      .update(syncJobs)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(syncJobs.id, id))
      .returning();
    return row ? toJob(row) : null;
  }
}
