import { describe, expect, it } from "vitest";
import { MemoryAccountsRepository, MemoryClock, MemoryProviderLinksRepository } from "./memory-repositories";
import type { NewAccount } from "../application/ports";

const newAccount = (over: Partial<NewAccount> = {}): NewAccount => ({
  userId: "u1",
  groupId: null,
  name: "Cash",
  type: "cash",
  currency: "EUR",
  origin: "manual",
  provider: null,
  status: "active",
  includeInNetWorth: true,
  notes: null,
  sortOrder: 0,
  ...over,
});

describe("MemoryAccountsRepository", () => {
  it("update returns version_mismatch when the stored version differs", async () => {
    const repo = new MemoryAccountsRepository();
    const account = await repo.create(newAccount());
    const stale = await repo.update("u1", account.id, account.version + 1, { name: "Renamed" });
    expect(stale).toBe("version_mismatch");
    const ok = await repo.update("u1", account.id, account.version, { name: "Renamed" });
    expect(ok).not.toBe("version_mismatch");
    expect(ok).not.toBeNull();
    expect((ok as Exclude<typeof ok, "version_mismatch" | null>).name).toBe("Renamed");
    expect((ok as Exclude<typeof ok, "version_mismatch" | null>).version).toBe(account.version + 1);
  });

  it("update returns null for an account outside the user's scope", async () => {
    const repo = new MemoryAccountsRepository();
    const account = await repo.create(newAccount());
    expect(await repo.update("someone-else", account.id, account.version, { name: "x" })).toBeNull();
  });

  it("recordBalances upserts on (accountId, asOf, source)", async () => {
    const repo = new MemoryAccountsRepository();
    const account = await repo.create(newAccount());
    await repo.recordBalances([
      { accountId: account.id, asOf: "2026-01-05", balance: "10.00", available: null, source: "manual" },
    ]);
    await repo.recordBalances([
      { accountId: account.id, asOf: "2026-01-05", balance: "15.00", available: null, source: "manual" },
    ]);
    const history = await repo.history("u1", [account.id], "2026-01-01");
    expect(history).toHaveLength(1);
    expect(history[0]?.balance).toBe("15.00");
  });

  it("latestBalances picks the greatest asOf per account", async () => {
    const repo = new MemoryAccountsRepository();
    const account = await repo.create(newAccount());
    await repo.recordBalances([
      { accountId: account.id, asOf: "2026-01-05", balance: "10.00", available: null, source: "manual" },
      { accountId: account.id, asOf: "2026-02-01", balance: "20.00", available: null, source: "manual" },
    ]);
    const latest = await repo.latestBalances("u1");
    expect(latest.get(account.id)?.balance).toBe("20.00");
  });

  it("list excludes archived accounts unless includeArchived is set", async () => {
    const repo = new MemoryAccountsRepository();
    const active = await repo.create(newAccount({ name: "Active" }));
    await repo.update("u1", active.id, active.version, {});
    const archived = await repo.create(newAccount({ name: "Archived", status: "archived" }));
    expect((await repo.list("u1")).map((a) => a.id)).toEqual([active.id]);
    expect((await repo.list("u1", { includeArchived: true })).map((a) => a.id).sort()).toEqual(
      [active.id, archived.id].sort(),
    );
  });
});

describe("MemoryProviderLinksRepository", () => {
  it("markMissing returns only the newly-missing entity ids", async () => {
    const repo = new MemoryProviderLinksRepository();
    await repo.upsertSeen(
      "u1",
      { provider: "wallet", entityType: "account", entityId: "acc-1", externalId: "ext-1", metadata: {} },
      new Date("2026-01-01"),
    );
    await repo.upsertSeen(
      "u1",
      { provider: "wallet", entityType: "account", entityId: "acc-2", externalId: "ext-2", metadata: {} },
      new Date("2026-01-01"),
    );
    const firstPass = await repo.markMissing("u1", "wallet", "account", ["ext-1"], new Date("2026-02-01"));
    expect(firstPass).toEqual(["acc-2"]);
    // Already missing: a second pass with the same seen set reports nothing new.
    const secondPass = await repo.markMissing("u1", "wallet", "account", ["ext-1"], new Date("2026-03-01"));
    expect(secondPass).toEqual([]);
  });

  it("liveFor returns null once a link is missing, and upsertSeen clears missingSince", async () => {
    const repo = new MemoryProviderLinksRepository();
    await repo.upsertSeen(
      "u1",
      { provider: "wallet", entityType: "account", entityId: "acc-1", externalId: "ext-1", metadata: {} },
      new Date("2026-01-01"),
    );
    expect(await repo.liveFor("account", "acc-1")).not.toBeNull();
    await repo.markMissing("u1", "wallet", "account", [], new Date("2026-02-01"));
    expect(await repo.liveFor("account", "acc-1")).toBeNull();
    await repo.upsertSeen(
      "u1",
      { provider: "wallet", entityType: "account", entityId: "acc-1", externalId: "ext-1", metadata: {} },
      new Date("2026-03-01"),
    );
    expect(await repo.liveFor("account", "acc-1")).not.toBeNull();
  });
});

describe("MemoryClock", () => {
  it("returns the set date", () => {
    const clock = new MemoryClock(new Date("2026-01-01T00:00:00Z"));
    expect(clock.now()).toEqual(new Date("2026-01-01T00:00:00Z"));
    clock.set(new Date("2026-06-01T00:00:00Z"));
    expect(clock.now()).toEqual(new Date("2026-06-01T00:00:00Z"));
  });
});
