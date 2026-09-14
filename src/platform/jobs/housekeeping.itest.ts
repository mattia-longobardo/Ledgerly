import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { hashToken } from "@/platform/auth/invitations";
import { invitations } from "@/platform/auth/schema";
import { getDb } from "@/platform/db/client";
import { housekeepingJob } from "./housekeeping";
import { jobRuns } from "./schema";

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

describe("housekeepingJob", () => {
  beforeEach(resetDatabase);
  afterAll(closeDatabase);

  it("prunes what is past the 90-day retention and keeps everything within it", async () => {
    const db = getDb();
    await db.insert(jobRuns).values([
      // finished past retention: pruned
      { job: "old", tier: "daily", status: "success", startedAt: daysAgo(91), finishedAt: daysAgo(91) },
      // finished within retention: kept
      { job: "recent", tier: "daily", status: "success", startedAt: daysAgo(89), finishedAt: daysAgo(89) },
      // never finished (crashed mid-run), started past retention: orphaned, pruned by started_at
      { job: "orphaned", tier: "daily", status: "running", startedAt: daysAgo(91), finishedAt: null },
      // never finished, started recently: still legitimately in flight, kept
      { job: "in-flight", tier: "daily", status: "running", startedAt: daysAgo(1), finishedAt: null },
    ]);
    await db.insert(invitations).values([
      // expired long ago, never accepted: pruned
      { email: "expired@example.test", tokenHash: hashToken("expired"), expiresAt: daysAgo(91) },
      // accepted long ago, even though its nominal expiry is still in the future: pruned
      {
        email: "accepted-old@example.test",
        tokenHash: hashToken("accepted-old"),
        expiresAt: daysAgo(-100),
        acceptedAt: daysAgo(91),
      },
      // pending, not expired: kept
      { email: "pending@example.test", tokenHash: hashToken("pending"), expiresAt: daysAgo(-1) },
    ]);

    const detail = await housekeepingJob.run();
    expect(detail).toEqual({ jobRunsDeleted: 2, invitationsDeleted: 2 });

    const remainingRuns = await db.select({ job: jobRuns.job }).from(jobRuns).orderBy(jobRuns.job);
    expect(remainingRuns.map((r) => r.job)).toEqual(["in-flight", "recent"]);

    const remainingInvitations = await db.select({ email: invitations.email }).from(invitations);
    expect(remainingInvitations.map((r) => r.email)).toEqual(["pending@example.test"]);
  });
});
