import "server-only";
import { lt, sql } from "drizzle-orm";
import { deleteExpiredInvitations } from "@/platform/auth/invitations";
import { getDb } from "@/platform/db/client";
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
    const invitationsDeleted = await deleteExpiredInvitations(cutoff);
    return { jobRunsDeleted: runs.length, invitationsDeleted };
  },
};
