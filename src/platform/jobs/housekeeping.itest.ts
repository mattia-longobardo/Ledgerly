import { asc } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { createTestUser } from "../../../test/users";
import { hashToken } from "@/platform/auth/invitations";
import { invitations } from "@/platform/auth/schema";
import { getDb } from "@/platform/db/client";
import { WALLET_PROVIDER } from "@/platform/integrations/rules";
import { syncRuns } from "@/platform/integrations/schema";
import { saveConnection } from "@/platform/integrations/service";
import { housekeepingJob } from "./housekeeping";
import { jobRuns } from "./schema";

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

/** A connection to hang sync runs off: `sync_runs` rows exist for one, by foreign key. */
async function walletConnection(): Promise<{ userId: string; connectionId: string }> {
  const user = await createTestUser();
  const connection = await saveConnection(
    { userId: user.id },
    { provider: WALLET_PROVIDER, credentials: { token: "wallet-token-5b1e7c" } },
  );
  return { userId: user.id, connectionId: connection.id };
}

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
    expect(detail).toEqual({
      jobRunsDeleted: 2,
      tokensDeleted: 0,
      backupsDeleted: 0,
      syncRunsDeleted: 0,
      invitationsDeleted: 2,
      notificationsDeleted: 0,
    });

    const remainingRuns = await db.select({ job: jobRuns.job }).from(jobRuns).orderBy(jobRuns.job);
    expect(remainingRuns.map((r) => r.job)).toEqual(["in-flight", "recent"]);

    const remainingInvitations = await db.select({ email: invitations.email }).from(invitations);
    expect(remainingInvitations.map((r) => r.email)).toEqual(["pending@example.test"]);
  });

  // Spec §10.2 prunes "executions and logs older than 90 days", and a sync run is an execution:
  // a revoked connection writes two skipped runs an hour and nothing else collects them.
  it("prunes the sync runs past the retention window, orphans included", async () => {
    const db = getDb();
    const { userId, connectionId } = await walletConnection();
    const run = (kind: "accounts" | "transactions", startedAt: Date, finishedAt: Date | null) => ({
      userId,
      connectionId,
      kind,
      state: (finishedAt === null ? "running" : "skipped") as "running" | "skipped",
      startedAt,
      finishedAt,
      error: finishedAt === null ? null : "token rejected",
    });
    await db.insert(syncRuns).values([
      run("accounts", daysAgo(91), daysAgo(91)),
      run("transactions", daysAgo(91), daysAgo(91)),
      run("accounts", daysAgo(89), daysAgo(89)),
      // Killed mid-pass 91 days ago: aged out by `started_at`, or it would be kept for ever.
      run("transactions", daysAgo(91), null),
      run("transactions", daysAgo(1), null),
    ]);

    expect(await housekeepingJob.run()).toMatchObject({ syncRunsDeleted: 3 });

    const left = await db
      .select({ startedAt: syncRuns.startedAt })
      .from(syncRuns)
      .orderBy(asc(syncRuns.startedAt));
    expect(left).toHaveLength(2);
    expect(left.every((row) => row.startedAt.getTime() > daysAgo(90).getTime())).toBe(true);
  });
});
