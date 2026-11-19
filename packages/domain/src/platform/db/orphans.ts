// The runs a process that died left `running` (rewrite plan R1, JOB-2): the worker closes them as
// `orphaned` when it starts. Written once for `job_runs` and `sync_runs`, which name their state
// column apart (`status`, `state`).
import { and, eq, lt } from "drizzle-orm";
import type { PgColumn, PgTable, PgUpdateSetSource } from "drizzle-orm/pg-core";
import { getDb } from "./client";

type RunTable = PgTable & { id: PgColumn; startedAt: PgColumn; finishedAt: PgColumn; error: PgColumn };

/** Closes the rows of `table` still `running` that started before `startedBefore`; how many. */
export async function closeOrphaned<T extends RunTable>(
  table: T,
  state: PgColumn,
  failed: PgUpdateSetSource<T>,
  startedBefore: Date,
): Promise<number> {
  const rows = await getDb()
    .update(table)
    .set(failed)
    .where(and(eq(state, "running"), lt(table.startedAt, startedBefore)))
    .returning({ id: table.id });
  return rows.length;
}
