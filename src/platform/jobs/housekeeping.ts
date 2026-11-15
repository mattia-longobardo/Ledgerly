import "server-only";
import { and, eq, lt, sql } from "drizzle-orm";
import { deleteExpiredInvitations } from "@/platform/auth/invitations";
import { pruneBackups } from "@/platform/backup/service";
import { getDb } from "@/platform/db/client";
import { closeOrphanRuns, deleteOldSyncRuns, SYNC_RUN_RETENTION_DAYS } from "@/platform/integrations/service";
import { deleteOldNotifications } from "@/platform/notifications/service";
import type { JobDefinition } from "./registry";
import { jobRuns } from "./schema";

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = 90 * DAY_MS;
/** Past this a job that never ended is nobody's any more: no job runs for an hour. */
const ORPHAN_AFTER_MS = 60 * 60 * 1000;

export const housekeepingJob: JobDefinition = {
  name: "housekeeping",
  tier: "daily",
  async run() {
    const now = new Date();
    const cutoff = new Date(now.getTime() - RETENTION_MS);
    // A run left `running` by a process that died is closed as failed, with its reason (N2).
    const orphanJobs = await getDb()
      .update(jobRuns)
      .set({ status: "failed", finishedAt: now, error: "orphaned" })
      .where(
        and(eq(jobRuns.status, "running"), lt(jobRuns.startedAt, new Date(now.getTime() - ORPHAN_AFTER_MS))),
      )
      .returning({ id: jobRuns.id });
    const orphanSyncRuns = await closeOrphanRuns(now);
    // A run that never finished (crashed mid-job) is orphaned, not retained forever: it ages out
    // by its start time.
    const runs = await getDb()
      .delete(jobRuns)
      .where(lt(sql`coalesce(${jobRuns.finishedAt}, ${jobRuns.startedAt})`, cutoff))
      .returning({ id: jobRuns.id });
    // A sync run is an execution too (spec §10.2), and its own table is the one that grows
    // without anybody touching it: a revoked connection records two skipped runs an hour, for
    // ever. Its owner prunes it, with the same care over a run that never finished.
    // 30 days, the window of the log under "Advanced" (rewrite plan, N2).
    const syncRunsDeleted = await deleteOldSyncRuns(
      new Date(now.getTime() - SYNC_RUN_RETENTION_DAYS * DAY_MS),
    );
    const invitationsDeleted = await deleteExpiredInvitations(cutoff);
    const notificationsDeleted = await deleteOldNotifications(cutoff);
    // Thirty dumps, not ninety days: a backup's worth is measured in how far back it reaches, and
    // thirty daily ones is what spec §10.2 asks for.
    const backupsDeleted = await pruneBackups();
    return {
      jobRunsDeleted: runs.length,
      orphansClosed: orphanJobs.length + orphanSyncRuns,
      syncRunsDeleted,
      invitationsDeleted,
      notificationsDeleted,
      backupsDeleted,
    };
  },
};
