import "server-only";
import { and, isNotNull, lt, or } from "drizzle-orm";
import { invitations } from "@/platform/auth/schema";
import { getDb } from "@/platform/db/client";
import type { JobDefinition } from "./registry";
import { jobRuns } from "./schema";

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export const housekeepingJob: JobDefinition = {
  name: "housekeeping",
  tier: "daily",
  async run() {
    const cutoff = new Date(Date.now() - RETENTION_MS);
    const runs = await getDb()
      .delete(jobRuns)
      .where(and(isNotNull(jobRuns.finishedAt), lt(jobRuns.finishedAt, cutoff)))
      .returning({ id: jobRuns.id });
    const invites = await getDb()
      .delete(invitations)
      .where(or(lt(invitations.expiresAt, cutoff), lt(invitations.acceptedAt, cutoff)))
      .returning({ id: invitations.id });
    return { jobRunsDeleted: runs.length, invitationsDeleted: invites.length };
  },
};
