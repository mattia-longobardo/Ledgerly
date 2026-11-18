import "server-only";
import { lt, sql } from "drizzle-orm";
import { deleteExpiredInvitations } from "@/platform/auth/invitations";
import { pruneBackups } from "@/platform/backup/service";
import { getDb } from "@ledgerly/domain/platform/db";
import {
  closeOrphanRuns,
  deleteOldSyncRuns,
  SYNC_RUN_RETENTION_DAYS,
} from "@ledgerly/domain/platform/integrations";
import { deleteOldNotifications } from "@/platform/notifications/service";
import type { JobDefinition } from "./registry";
import { closeOrphanJobRuns, jobRuns } from "@ledgerly/domain/platform/jobs";
import { deleteExpiredLimits } from "@ledgerly/domain/platform/limits";

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
    // After the pruning, so an orphan past the retention goes as it always did: a run left
    // `running` by a process that died is closed as failed, with its reason (rewrite plan, N2).
    // The dispatcher closes the sync runs every time it passes; this is the net under it, and the
    // only one for the jobs. Not in the detail: nothing was deleted.
    await closeOrphanJobRuns(new Date(now.getTime() - ORPHAN_AFTER_MS), now);
    await closeOrphanRuns(now);
    // The windows of the shared limits that have run out (rewrite plan R1). Not in the detail.
    await deleteExpiredLimits(now);
    return {
      jobRunsDeleted: runs.length,
      syncRunsDeleted,
      invitationsDeleted,
      notificationsDeleted,
      backupsDeleted,
    };
  },
};
