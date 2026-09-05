import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, resetDb, testDb } from "@/test/db";
import { organizations, roles, userRoles, users } from "@/lib/db/schema";
import { withUserContext } from "@/platform/db/context";
import { credentialCipher } from "@/platform/integrations/crypto";
import { DrizzleConnectionsRepository } from "@/modules/integrations/infrastructure/drizzle-connections-repository";
import { DrizzleSyncJobsRepository } from "@/modules/integrations/infrastructure/drizzle-sync-jobs-repository";

/**
 * Records exactly what `getRecords` was called with on each pass, so the
 * cursor-persistence assertion below inspects the real request the second
 * run made rather than trusting the stored cursor alone. `getAccounts` is
 * mocked too because `ensureProvidersRegistered()` registers the real
 * `walletProvider`, which declares an `accounts` sync as well — unused here,
 * but its `testConnection` path is reachable if anything upstream ever calls
 * it, and a real HTTP call must never happen in a test.
 */
const calls = vi.hoisted(() => ({ sinceDates: [] as (string | null)[] }));

vi.mock("@/lib/clients/wallet", () => ({
  getAccounts: vi.fn(async () => []),
  getRecords: vi.fn(async (opts: { sinceDate?: string }) => {
    calls.sinceDates.push(opts.sinceDate ?? null);
    return [
      {
        id: `r-${calls.sinceDates.length}`,
        accountId: "w1",
        amount: -12.5,
        currencyCode: "EUR",
        recordType: "expense",
        recordState: "cleared",
        recordDate: "2026-09-04T08:00:00Z",
        categoryId: null,
        labels: [],
      },
    ];
  }),
  getCategories: vi.fn(async () => []),
}));

import { runWalletTransactionsSync } from "./wallet-transactions-sync";

/** The exact lookback `wallet-provider-adapter.ts`'s `transactionsSync.fetch` applies to a stored cursor. */
function lookback(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

describe("wallet transactions sync job — the carried gap", () => {
  beforeEach(async () => {
    await resetDb();
    calls.sinceDates = [];
  });
  afterAll(closeDb);

  it("backfills the missing sync_jobs row for a connection that predates this phase, and persists the cursor across runs", async () => {
    const db = await testDb();
    await db.insert(roles).values({ code: "owner", label: "Owner" }).onConflictDoNothing();
    const [org] = await db.insert(organizations).values({ name: "P" }).returning();
    const [user] = await db.insert(users).values({ organizationId: org!.id, displayName: "Owner" }).returning();
    await db.insert(userRoles).values({ userId: user!.id, roleCode: "owner" });

    // A connection exactly as one made before this phase would look: usable,
    // credentialed, and — because `connectIntegration` only `ensure()`s a
    // `sync_jobs` row for a kind the provider declared at THAT time — no
    // `transactions` row at all. Built directly with the repository, not
    // `connectIntegration`, specifically to skip the `ensure()` loop that
    // would otherwise mask the gap this test exists to prove closed.
    const connection = await withUserContext(db, { userId: user!.id }, (tx) =>
      new DrizzleConnectionsRepository(tx).create({
        userId: user!.id,
        provider: "wallet",
        status: "connected",
        settings: {},
        disconnectPolicy: "keep",
      }),
    );
    await withUserContext(db, { userId: user!.id }, (tx) =>
      new DrizzleConnectionsRepository(tx).writeCredentials(
        user!.id,
        connection.id,
        credentialCipher().seal({ token: "good", webhookSecret: "" }),
      ),
    );

    const before = await withUserContext(db, { userId: user!.id }, (tx) =>
      new DrizzleSyncJobsRepository(tx).find(connection.id, "transactions"),
    );
    expect(before).toBeNull();

    // ── First run: no job row, so `fetch` gets no cursor and requests the
    // provider's default window.
    const first = await runWalletTransactionsSync();
    expect(first.status).toBe("success");
    expect(calls.sinceDates).toEqual([null]);

    const jobAfterFirst = await withUserContext(db, { userId: user!.id }, (tx) =>
      new DrizzleSyncJobsRepository(tx).find(connection.id, "transactions"),
    );
    // The row now exists — `run-sync.ts`'s own `prepare()` `ensure()`s it
    // before the sync ever runs, whichever caller reached it — and the run's
    // cursor was actually written to it, proving the write Task 8 left
    // silently discarded (`prepared.jobId` was null) now lands.
    expect(jobAfterFirst).not.toBeNull();
    const cursor = jobAfterFirst!.cursor as { sinceDate: string } | null;
    expect(cursor?.sinceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // ── Second run: the job row (and its cursor) already exist.
    const second = await runWalletTransactionsSync();
    expect(second.status).toBe("success");
    expect(calls.sinceDates).toHaveLength(2);

    // The window the second run actually requested is derived from the first
    // run's persisted cursor — seven days before it — not the provider's
    // default window (`null`) the first run used.
    expect(calls.sinceDates[1]).not.toBeNull();
    expect(calls.sinceDates[1]).toBe(lookback(cursor!.sinceDate, 7));

    // Exactly one `sync_jobs` row for this (connection, kind) across both
    // runs — `ensure()`'s ON CONFLICT DO NOTHING held, it did not duplicate.
    const jobAfterSecond = await withUserContext(db, { userId: user!.id }, (tx) =>
      new DrizzleSyncJobsRepository(tx).find(connection.id, "transactions"),
    );
    expect(jobAfterSecond!.id).toBe(jobAfterFirst!.id);
    expect((jobAfterSecond!.cursor as { sinceDate: string }).sinceDate >= cursor!.sinceDate).toBe(true);
  });
});
