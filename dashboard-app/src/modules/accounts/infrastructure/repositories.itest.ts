import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { organizations, users } from "@/lib/db/schema";
import { withUserContext } from "@/platform/db/context";
import { closeDb, resetDb, testDb } from "@/test/db";
import type { NewAccount } from "../application/ports";
import { DrizzleAccountsRepository } from "./drizzle-accounts-repository";
import { DrizzleGroupsRepository } from "./drizzle-groups-repository";
import { DrizzleProviderLinksRepository } from "./drizzle-provider-links-repository";

/** Identity tables carry no RLS, so the seed runs on the bare connection. */
async function seedUsers(): Promise<{ a: string; b: string }> {
  const db = await testDb();
  const [org] = await db.insert(organizations).values({ name: "Household" }).returning();
  const [a] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
  const [b] = await db.insert(users).values({ organizationId: org!.id, displayName: "B" }).returning();
  return { a: a!.id, b: b!.id };
}

function manualAccount(userId: string, over: Partial<NewAccount> = {}): NewAccount {
  return {
    userId,
    groupId: null,
    name: "Main current",
    type: "checking",
    currency: "EUR",
    origin: "manual",
    provider: null,
    status: "active",
    includeInNetWorth: true,
    notes: null,
    sortOrder: 0,
    ...over,
  };
}

/** Runs `fn` with a repository bound to a transaction that carries the user's RLS context. */
async function asUser<T>(userId: string, fn: (repo: DrizzleAccountsRepository) => Promise<T>): Promise<T> {
  const db = await testDb();
  return withUserContext(db, { userId }, (tx) => fn(new DrizzleAccountsRepository(tx)));
}

async function asLinkUser<T>(userId: string, fn: (repo: DrizzleProviderLinksRepository) => Promise<T>): Promise<T> {
  const db = await testDb();
  return withUserContext(db, { userId }, (tx) => fn(new DrizzleProviderLinksRepository(tx)));
}

describe("DrizzleAccountsRepository", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("creates, reads back, and lists accounts ordered by sort order then name", async () => {
    const { a } = await seedUsers();
    const created = await asUser(a, async (repo) => {
      const savings = await repo.create(manualAccount(a, { name: "Savings", type: "savings", sortOrder: 1 }));
      const zeta = await repo.create(manualAccount(a, { name: "Zeta", sortOrder: 0 }));
      const alpha = await repo.create(manualAccount(a, { name: "Alpha", sortOrder: 0 }));
      return { savings, zeta, alpha };
    });

    expect(created.savings.version).toBe(1);
    expect(created.savings.archivedAt).toBeNull();
    expect(created.savings.createdAt).toBeInstanceOf(Date);

    const fetched = await asUser(a, (repo) => repo.get(a, created.savings.id));
    expect(fetched).toEqual(created.savings);

    const names = await asUser(a, async (repo) => (await repo.list(a)).map((x) => x.name));
    expect(names).toEqual(["Alpha", "Zeta", "Savings"]);
  });

  it("excludes archived accounts from list unless asked for them", async () => {
    const { a } = await seedUsers();
    const archived = await asUser(a, (repo) => repo.create(manualAccount(a, { name: "Old", status: "archived" })));

    expect(await asUser(a, async (repo) => (await repo.list(a)).map((x) => x.id))).toEqual([]);
    expect(await asUser(a, async (repo) => (await repo.list(a, { includeArchived: true })).map((x) => x.id))).toEqual([
      archived.id,
    ]);
  });

  it("does not expose another user's account", async () => {
    const { a, b } = await seedUsers();
    const mine = await asUser(a, (repo) => repo.create(manualAccount(a)));

    expect(await asUser(b, (repo) => repo.get(a, mine.id))).toBeNull();
    expect(await asUser(b, (repo) => repo.get(b, mine.id))).toBeNull();
    expect(await asUser(b, (repo) => repo.list(b))).toEqual([]);
  });

  it("updates on a matching version, reports a mismatch on a stale one, and null when absent", async () => {
    const { a } = await seedUsers();
    const account = await asUser(a, (repo) => repo.create(manualAccount(a)));

    const updated = await asUser(a, (repo) => repo.update(a, account.id, 1, { name: "Renamed", sortOrder: 4 }));
    expect(updated).toMatchObject({ name: "Renamed", sortOrder: 4, version: 2 });

    expect(await asUser(a, (repo) => repo.update(a, account.id, 1, { name: "Stale" }))).toBe("version_mismatch");
    expect(await asUser(a, (repo) => repo.update(a, crypto.randomUUID(), 1, { name: "Ghost" }))).toBeNull();
    expect(await asUser(a, async (repo) => (await repo.get(a, account.id))!.name)).toBe("Renamed");
  });

  it("deletes an owned account once and reports nothing to delete afterwards", async () => {
    const { a } = await seedUsers();
    const account = await asUser(a, (repo) => repo.create(manualAccount(a)));

    expect(await asUser(a, (repo) => repo.delete(a, account.id))).toBe(true);
    expect(await asUser(a, (repo) => repo.delete(a, account.id))).toBe(false);
    expect(await asUser(a, (repo) => repo.get(a, account.id))).toBeNull();
  });

  it("upserts a balance on (accountId, asOf, source) instead of adding a second row", async () => {
    const { a } = await seedUsers();
    const account = await asUser(a, (repo) => repo.create(manualAccount(a)));

    await asUser(a, (repo) =>
      repo.recordBalances([
        {
          accountId: account.id,
          asOf: "2026-01-31",
          balance: "100.00",
          available: null,
          source: "manual",
          capturedAt: new Date("2026-01-31T10:00:00Z"),
        },
      ]),
    );
    await asUser(a, (repo) =>
      repo.recordBalances([
        {
          accountId: account.id,
          asOf: "2026-01-31",
          balance: "250.50",
          available: "200.00",
          source: "manual",
          capturedAt: new Date("2026-01-31T18:00:00Z"),
        },
      ]),
    );

    const history = await asUser(a, (repo) => repo.history(a, [account.id], "2026-01-01"));
    expect(history).toEqual([
      {
        accountId: account.id,
        asOf: "2026-01-31",
        balance: "250.50",
        available: "200.00",
        source: "manual",
        capturedAt: new Date("2026-01-31T18:00:00Z"),
      },
    ]);
  });

  it("returns the latest balance per account and history from a cut-off date", async () => {
    const { a } = await seedUsers();
    const { one, two } = await asUser(a, async (repo) => {
      const one = await repo.create(manualAccount(a, { name: "One" }));
      const two = await repo.create(manualAccount(a, { name: "Two", sortOrder: 1 }));
      await repo.recordBalances([
        { accountId: one.id, asOf: "2026-01-31", balance: "10.00", available: null, source: "manual" },
        { accountId: one.id, asOf: "2026-02-28", balance: "20.00", available: null, source: "manual" },
        { accountId: one.id, asOf: "2026-03-31", balance: "30.00", available: null, source: "manual" },
        { accountId: two.id, asOf: "2026-02-28", balance: "5.00", available: null, source: "manual" },
      ]);
      return { one, two };
    });

    const latest = await asUser(a, (repo) => repo.latestBalances(a));
    expect(latest.get(one.id)).toMatchObject({ asOf: "2026-03-31", balance: "30.00", source: "manual" });
    expect(latest.get(one.id)!.capturedAt).toBeInstanceOf(Date);
    expect(latest.get(two.id)).toMatchObject({ asOf: "2026-02-28", balance: "5.00" });

    const history = await asUser(a, (repo) => repo.history(a, [one.id], "2026-02-28"));
    expect(history.map((p) => p.asOf)).toEqual(["2026-02-28", "2026-03-31"]);
  });

  it("seeds a windowed series from the newest balance strictly before the window", async () => {
    const { a, b } = await seedUsers();
    const { mine, theirs } = await asUser(a, async (repo) => {
      const mine = await repo.create(manualAccount(a, { name: "Dormant" }));
      await repo.recordBalances([
        { accountId: mine.id, asOf: "2025-10-31", balance: "10.00", available: null, source: "manual" },
        {
          accountId: mine.id,
          asOf: "2025-12-31",
          balance: "20.00",
          available: null,
          source: "manual",
          capturedAt: new Date("2025-12-31T08:00:00Z"),
        },
        {
          // Same day, captured later: the newer capture is the seed.
          accountId: mine.id,
          asOf: "2025-12-31",
          balance: "21.00",
          available: null,
          source: "provider",
          capturedAt: new Date("2025-12-31T20:00:00Z"),
        },
        { accountId: mine.id, asOf: "2026-02-28", balance: "30.00", available: null, source: "manual" },
      ]);
      return { mine, theirs: null };
    });
    const other = await asUser(b, async (repo) => {
      const other = await repo.create(manualAccount(b, { name: "Theirs" }));
      await repo.recordBalances([
        { accountId: other.id, asOf: "2025-12-31", balance: "99.00", available: null, source: "manual" },
      ]);
      return other;
    });
    expect(theirs).toBeNull();

    const seeds = await asUser(a, (repo) => repo.latestBalancesBefore(a, [mine.id, other.id], "2026-01-01"));
    expect(seeds.get(mine.id)).toMatchObject({ asOf: "2025-12-31", balance: "21.00", source: "provider" });
    // RLS keeps the other user's row out even though its id was asked for.
    expect(seeds.has(other.id)).toBe(false);

    const none = await asUser(a, (repo) => repo.latestBalancesBefore(a, [mine.id], "2025-01-01"));
    expect(none.size).toBe(0);
    expect((await asUser(a, (repo) => repo.latestBalancesBefore(a, [], "2026-01-01"))).size).toBe(0);
  });

  it("prefers the most recently captured row when two sources share the latest date", async () => {
    const { a } = await seedUsers();
    const account = await asUser(a, (repo) => repo.create(manualAccount(a)));
    await asUser(a, (repo) =>
      repo.recordBalances([
        {
          accountId: account.id,
          asOf: "2026-03-31",
          balance: "10.00",
          available: null,
          source: "manual",
          capturedAt: new Date("2026-03-31T08:00:00Z"),
        },
        {
          accountId: account.id,
          asOf: "2026-03-31",
          balance: "11.00",
          available: null,
          source: "provider",
          capturedAt: new Date("2026-03-31T20:00:00Z"),
        },
      ]),
    );

    const latest = await asUser(a, (repo) => repo.latestBalances(a));
    expect(latest.get(account.id)).toMatchObject({ balance: "11.00", source: "provider" });
  });

  // Pins the current answer, not a desirable one — see the known gap recorded
  // on `DrizzleAccountsRepository.hasReferences`.
  it("still reports no references for any account", async () => {
    const { a } = await seedUsers();
    const account = await asUser(a, (repo) => repo.create(manualAccount(a)));
    expect(await asUser(a, (repo) => repo.hasReferences(account.id))).toBe(false);
  });
});

describe("DrizzleGroupsRepository", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  /** Runs `fn` with a repository bound to a transaction that carries the user's RLS context. */
  async function asGroupUser<T>(userId: string, fn: (repo: DrizzleGroupsRepository) => Promise<T>): Promise<T> {
    const db = await testDb();
    return withUserContext(db, { userId }, (tx) => fn(new DrizzleGroupsRepository(tx)));
  }

  it("create() rejects a duplicate (userId, name) with duplicate_name, and the surrounding transaction survives to run another statement", async () => {
    const { a } = await seedUsers();
    await asGroupUser(a, async (repo) => {
      await repo.create(a, "Everyday");
      const second = await repo.create(a, "Everyday");
      expect(second).toBe("duplicate_name");
      // If the caught unique-violation had left the surrounding transaction
      // aborted (no savepoint), this next statement — on the same open
      // transaction — would fail with "current transaction is aborted",
      // not merely return the wrong thing.
      expect((await repo.list(a)).map((g) => g.name)).toEqual(["Everyday"]);
    });
  });

  it("rename() rejects a rename onto an existing name with duplicate_name, and the surrounding transaction survives to run another statement", async () => {
    const { a } = await seedUsers();
    await asGroupUser(a, async (repo) => {
      await repo.create(a, "Everyday");
      const toRename = await repo.create(a, "Savings");
      if (toRename === "duplicate_name") throw new Error("expected create() to succeed, got duplicate_name");
      const second = await repo.rename(a, toRename.id, "Everyday");
      expect(second).toBe("duplicate_name");
      // Same aborted-transaction hazard as create() above, exercised via rename().
      expect((await repo.list(a)).map((g) => g.name).sort()).toEqual(["Everyday", "Savings"]);
    });
  });
});

describe("DrizzleProviderLinksRepository", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("stores a seen link, marks it missing, and revives it on the next sight", async () => {
    const { a } = await seedUsers();
    const account = await asUser(a, (repo) => repo.create(manualAccount(a, { origin: "synced", provider: "gocardless" })));
    const link = {
      provider: "gocardless",
      entityType: "account" as const,
      entityId: account.id,
      externalId: "ext-1",
      metadata: { iban: "IT60X" },
    };

    await asLinkUser(a, (repo) => repo.upsertSeen(a, link, new Date("2026-03-01T00:00:00Z")));

    const found = await asLinkUser(a, (repo) => repo.byExternal(a, "gocardless", "account", ["ext-1", "ext-2"]));
    expect(found.size).toBe(1);
    expect(found.get("ext-1")).toEqual({ ...link, missingSince: null });
    expect(await asLinkUser(a, (repo) => repo.liveFor("account", account.id))).toEqual({ ...link, missingSince: null });

    const missingAt = new Date("2026-03-08T00:00:00Z");
    expect(await asLinkUser(a, (repo) => repo.markMissing(a, "gocardless", "account", [], missingAt))).toEqual([
      account.id,
    ]);
    expect(await asLinkUser(a, (repo) => repo.markMissing(a, "gocardless", "account", [], missingAt))).toEqual([]);
    expect(await asLinkUser(a, (repo) => repo.liveFor("account", account.id))).toBeNull();
    expect(
      (await asLinkUser(a, (repo) => repo.byExternal(a, "gocardless", "account", ["ext-1"]))).get("ext-1")!.missingSince,
    ).toEqual(missingAt);

    await asLinkUser(a, (repo) => repo.upsertSeen(a, link, new Date("2026-03-15T00:00:00Z")));
    expect(await asLinkUser(a, (repo) => repo.liveFor("account", account.id))).toEqual({ ...link, missingSince: null });
  });

  it("leaves links whose external id was seen alone", async () => {
    const { a } = await seedUsers();
    const { kept, gone } = await asUser(a, async (repo) => ({
      kept: await repo.create(manualAccount(a, { name: "Kept", origin: "synced", provider: "gocardless" })),
      gone: await repo.create(manualAccount(a, { name: "Gone", origin: "synced", provider: "gocardless" })),
    }));
    const seenAt = new Date("2026-03-01T00:00:00Z");
    await asLinkUser(a, async (repo) => {
      const base = { provider: "gocardless", entityType: "account" as const, metadata: {} };
      await repo.upsertSeen(a, { ...base, entityId: kept.id, externalId: "kept" }, seenAt);
      await repo.upsertSeen(a, { ...base, entityId: gone.id, externalId: "gone" }, seenAt);
    });

    const missing = await asLinkUser(a, (repo) =>
      repo.markMissing(a, "gocardless", "account", ["kept"], new Date("2026-03-08T00:00:00Z")),
    );
    expect(missing).toEqual([gone.id]);
    expect(await asLinkUser(a, (repo) => repo.liveFor("account", kept.id))).not.toBeNull();
  });

  it("does not return another user's link", async () => {
    const { a, b } = await seedUsers();
    const account = await asUser(a, (repo) => repo.create(manualAccount(a, { origin: "synced", provider: "gocardless" })));
    await asLinkUser(a, (repo) =>
      repo.upsertSeen(
        a,
        { provider: "gocardless", entityType: "account", entityId: account.id, externalId: "ext-1", metadata: {} },
        new Date("2026-03-01T00:00:00Z"),
      ),
    );

    expect(await asLinkUser(b, (repo) => repo.byExternal(b, "gocardless", "account", ["ext-1"]))).toEqual(new Map());
    expect(await asLinkUser(b, (repo) => repo.liveFor("account", account.id))).toBeNull();
  });

  it("round-trips a non-account entity type (transaction)", async () => {
    const { a } = await seedUsers();
    const entityId = crypto.randomUUID();
    const link = {
      provider: "wallet",
      entityType: "transaction" as const,
      entityId,
      externalId: "ext-tx-1",
      metadata: {},
    };

    await asLinkUser(a, (repo) => repo.upsertSeen(a, link, new Date("2026-03-01T00:00:00Z")));

    const found = await asLinkUser(a, (repo) => repo.byExternal(a, "wallet", "transaction", ["ext-tx-1"]));
    expect(found.get("ext-tx-1")).toEqual({ ...link, missingSince: null });
    expect(await asLinkUser(a, (repo) => repo.liveFor("transaction", entityId))).toEqual({
      ...link,
      missingSince: null,
    });
  });
});
