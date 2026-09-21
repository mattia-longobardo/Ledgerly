import "server-only";
import { lt, sql } from "drizzle-orm";
import { deleteExpiredInvitations } from "@/platform/auth/invitations";
import { getDb } from "@/platform/db/client";
import { deleteOldSyncRuns } from "@/platform/integrations/service";
import { deleteOldNotifications } from "@/platform/notifications/service";
import { deleteStaleTokens } from "@/platform/tokens/service";
import type { JobDefinition } from "./registry";
import { jobRuns } from "./schema";

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export const housekeepingJob: JobDefinition = {
  name: "housekeeping",
  tier: "daily",
  async run() {
    const cutoff = new Date(Date.now() - RETENTION_MS);
    // A run that never finished (crashed mid-job) is orphaned, not retained forever: it ages out
    // by its start time.
    const runs = await getDb()
      .delete(jobRuns)
      .where(lt(sql`coalesce(${jobRuns.finishedAt}, ${jobRuns.startedAt})`, cutoff))
      .returning({ id: jobRuns.id });
    // A sync run is an execution too (spec §10.2), and its own table is the one that grows
    // without anybody touching it: a revoked connection records two skipped runs an hour, for
    // ever. Its owner prunes it, with the same care over a run that never finished.
    const syncRunsDeleted = await deleteOldSyncRuns(cutoff);
    const invitationsDeleted = await deleteExpiredInvitations(cutoff);
    const notificationsDeleted = await deleteOldNotifications(cutoff);
    // A personal access token revoked or expired three months ago is no longer evidence of
    // anything: its `last_used_at` has aged out with the rest (spec §10.2).
    const tokensDeleted = await deleteStaleTokens(cutoff);
    return {
      jobRunsDeleted: runs.length,
      syncRunsDeleted,
      invitationsDeleted,
      notificationsDeleted,
      tokensDeleted,
    };
  },
};
