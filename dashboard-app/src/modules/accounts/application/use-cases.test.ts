import { describe, expect, it } from "vitest";
import {
  MemoryAccountsRepository,
  MemoryClock,
  MemoryGroupsRepository,
  MemoryProviderLinksRepository,
} from "../infrastructure/memory-repositories";
import { createManualAccount } from "./create-manual-account";
import { deleteAccount } from "./delete-account";
import { getAccountDetail } from "./get-account-detail";
import { recordManualBalance } from "./record-manual-balance";
import { listAccounts } from "./list-accounts";
import { updateAccount } from "./update-account";
import { DeletionBlockedError, InvalidInputError, VersionMismatchError } from "./errors";
import { PermissionDeniedError } from "@/platform/auth/principal";
import { testPrincipal } from "@/test/principal";

function harness() {
  const audit: unknown[] = [];
  const deps = {
    accounts: new MemoryAccountsRepository(),
    links: new MemoryProviderLinksRepository(),
    groups: new MemoryGroupsRepository(),
    clock: new MemoryClock(new Date("2026-09-02T12:00:00Z")),
    audit: async (e: unknown) => {
      audit.push(e);
    },
  };
  return { deps, audit };
}

describe("accounts use cases", () => {
  it("creates a manual account with an opening balance and audits it", async () => {
    const { deps, audit } = harness();
    const a = await createManualAccount(deps)(testPrincipal(), {
      name: "EToro", type: "investment", openingBalance: { asOf: "2026-08-31", balance: "1234.50" },
    });
    expect(a.origin).toBe("manual");
    const [item] = await listAccounts(deps)(testPrincipal());
    expect(item?.latest?.balance).toBe("1234.50");
    expect(audit).toHaveLength(1);
  });

  it("viewer cannot create", async () => {
    const { deps } = harness();
    await expect(
      createManualAccount(deps)(testPrincipal({ roles: ["viewer"] }), { name: "x", type: "cash" }),
    ).rejects.toThrow(PermissionDeniedError);
  });

  it("update requires the current version", async () => {
    const { deps } = harness();
    const a = await createManualAccount(deps)(testPrincipal(), { name: "x", type: "cash" });
    await updateAccount(deps)(testPrincipal(), a.id, 1, { name: "y" });
    await expect(updateAccount(deps)(testPrincipal(), a.id, 1, { name: "z" })).rejects.toThrow(VersionMismatchError);
  });

  it("rejects a future balance date", async () => {
    const { deps } = harness();
    const a = await createManualAccount(deps)(testPrincipal(), { name: "x", type: "cash" });
    await expect(
      recordManualBalance(deps)(testPrincipal(), a.id, { asOf: "2027-01-01", balance: "1" }),
    ).rejects.toThrow(/future/);
  });

  it("hard-deletes an unreferenced manual account and blocks a live synced one", async () => {
    const { deps } = harness();
    const a = await createManualAccount(deps)(testPrincipal(), { name: "x", type: "cash" });
    expect(await deleteAccount(deps)(testPrincipal(), a.id)).toEqual({ outcome: "deleted" });
    const synced = await deps.accounts.create({
      userId: testPrincipal().userId, groupId: null, name: "ING", type: "checking", currency: "EUR",
      origin: "synced", provider: "wallet", status: "active", includeInNetWorth: true, notes: null, sortOrder: 0,
    });
    await deps.links.upsertSeen(
      testPrincipal().userId,
      { provider: "wallet", entityType: "account", entityId: synced.id, externalId: "ext-1", metadata: {} },
      new Date(),
    );
    await expect(deleteAccount(deps)(testPrincipal(), synced.id)).rejects.toThrow(DeletionBlockedError);
  });

  it("cannot see another user's account", async () => {
    const { deps } = harness();
    const a = await createManualAccount(deps)(testPrincipal(), { name: "x", type: "cash" });
    const other = testPrincipal({ userId: "00000000-0000-7000-8000-000000000002" });
    await expect(updateAccount(deps)(other, a.id, 1, { name: "y" })).rejects.toThrow(/not found/i);
  });

  it("archives a linked synced account when the caller confirms, and audits account.archive", async () => {
    const { deps, audit } = harness();
    const synced = await deps.accounts.create({
      userId: testPrincipal().userId, groupId: null, name: "ING", type: "checking", currency: "EUR",
      origin: "synced", provider: "wallet", status: "active", includeInNetWorth: true, notes: null, sortOrder: 0,
    });
    await deps.links.upsertSeen(
      testPrincipal().userId,
      { provider: "wallet", entityType: "account", entityId: synced.id, externalId: "ext-1", metadata: {} },
      new Date(),
    );
    expect(await deleteAccount(deps)(testPrincipal(), synced.id, { confirmSynced: true })).toEqual({
      outcome: "archived",
    });
    expect(audit).toEqual([expect.objectContaining({ action: "account.archive", entityId: synced.id })]);
    expect(await listAccounts(deps)(testPrincipal())).toHaveLength(0);
    const [archived] = await listAccounts(deps)(testPrincipal(), { includeArchived: true });
    expect(archived?.account.status).toBe("archived");
    expect(archived?.account.archivedAt).toEqual(deps.clock.now());
  });

  it("archives an unlinked synced account rather than deleting it", async () => {
    const { deps } = harness();
    const synced = await deps.accounts.create({
      userId: testPrincipal().userId, groupId: null, name: "Old ING", type: "checking", currency: "EUR",
      origin: "synced", provider: "wallet", status: "active", includeInNetWorth: true, notes: null, sortOrder: 0,
    });
    expect(await deleteAccount(deps)(testPrincipal(), synced.id)).toEqual({ outcome: "archived" });
  });

  it("refuses to restore an account that is not archived", async () => {
    const { deps } = harness();
    const a = await createManualAccount(deps)(testPrincipal(), { name: "x", type: "cash" });
    await expect(
      updateAccount(deps)(testPrincipal(), a.id, a.version, { status: "active" }),
    ).rejects.toThrow(/only an archived account/i);
  });

  it("restores an archived manual account to active and clears archivedAt", async () => {
    const { deps } = harness();
    const a = await createManualAccount(deps)(testPrincipal(), { name: "x", type: "cash" });
    const archived = await deps.accounts.update(testPrincipal().userId, a.id, a.version, {
      status: "archived", archivedAt: deps.clock.now(),
    });
    if (archived === null || archived === "version_mismatch") throw new Error("setup failed");
    const restored = await updateAccount(deps)(testPrincipal(), a.id, archived.version, {
      status: "active", archivedAt: null,
    });
    expect(restored.status).toBe("active");
    expect(restored.archivedAt).toBeNull();
  });

  it("restores an archived synced account to unavailable when its link is still missing", async () => {
    const { deps } = harness();
    const synced = await deps.accounts.create({
      userId: testPrincipal().userId, groupId: null, name: "ING", type: "checking", currency: "EUR",
      origin: "synced", provider: "wallet", status: "active", includeInNetWorth: true, notes: null, sortOrder: 0,
    });
    await deps.links.upsertSeen(
      testPrincipal().userId,
      { provider: "wallet", entityType: "account", entityId: synced.id, externalId: "ext-1", metadata: {} },
      deps.clock.now(),
    );
    // The provider stopped reporting this account: the link is now missing.
    await deps.links.markMissing(testPrincipal().userId, "wallet", "account", [], deps.clock.now());
    const archived = await deps.accounts.update(testPrincipal().userId, synced.id, synced.version, {
      status: "archived", archivedAt: deps.clock.now(),
    });
    if (archived === null || archived === "version_mismatch") throw new Error("setup failed");
    const restored = await updateAccount(deps)(testPrincipal(), synced.id, archived.version, {
      status: "active", archivedAt: null,
    });
    expect(restored.status).toBe("unavailable");
    expect(restored.archivedAt).toBeNull();
  });

  it("refuses to change the type or currency of a synced account", async () => {
    const { deps } = harness();
    const synced = await deps.accounts.create({
      userId: testPrincipal().userId, groupId: null, name: "ING", type: "checking", currency: "EUR",
      origin: "synced", provider: "wallet", status: "active", includeInNetWorth: true, notes: null, sortOrder: 0,
    });
    await expect(updateAccount(deps)(testPrincipal(), synced.id, 1, { type: "savings" })).rejects.toThrow(
      /managed by the provider/,
    );
    await expect(updateAccount(deps)(testPrincipal(), synced.id, 1, { currency: "USD" })).rejects.toThrow(
      InvalidInputError,
    );
    const renamed = await updateAccount(deps)(testPrincipal(), synced.id, 1, { name: "ING Direct" });
    expect(renamed.name).toBe("ING Direct");
  });

  it("audits an update with the account before and after the change", async () => {
    const { deps, audit } = harness();
    const a = await createManualAccount(deps)(testPrincipal(), { name: "x", type: "cash" });
    await updateAccount(deps)(testPrincipal(), a.id, 1, { name: "y" });
    expect(audit[1]).toMatchObject({
      action: "account.update",
      entityId: a.id,
      before: { name: "x" },
      after: { name: "y", version: 2 },
    });
  });

  it("records a manual balance as source manual and audits account.balance", async () => {
    const { deps, audit } = harness();
    const a = await createManualAccount(deps)(testPrincipal(), { name: "x", type: "cash" });
    await recordManualBalance(deps)(testPrincipal(), a.id, { asOf: "2026-09-02", balance: "10.00" });
    const latest = await deps.accounts.latestBalances(testPrincipal().userId);
    expect(latest.get(a.id)).toMatchObject({ balance: "10.00", source: "manual", available: null });
    expect(audit[1]).toMatchObject({ action: "account.balance", entityId: a.id });
  });

  it("refuses a manual balance on a synced account", async () => {
    const { deps } = harness();
    const synced = await deps.accounts.create({
      userId: testPrincipal().userId, groupId: null, name: "ING", type: "checking", currency: "EUR",
      origin: "synced", provider: "wallet", status: "active", includeInNetWorth: true, notes: null, sortOrder: 0,
    });
    await expect(
      recordManualBalance(deps)(testPrincipal(), synced.id, { asOf: "2026-09-01", balance: "1" }),
    ).rejects.toThrow(/come from the provider/);
  });

  it("marks a synced account stale once its capture is older than 36 hours, never a manual one", async () => {
    const { deps } = harness();
    const now = deps.clock.now();
    const manual = await createManualAccount(deps)(testPrincipal(), {
      name: "Cash", type: "cash", openingBalance: { asOf: "2026-01-01", balance: "5.00" },
    });
    const fresh = await deps.accounts.create({
      userId: testPrincipal().userId, groupId: null, name: "Fresh", type: "checking", currency: "EUR",
      origin: "synced", provider: "wallet", status: "active", includeInNetWorth: true, notes: null, sortOrder: 1,
    });
    const old = await deps.accounts.create({
      userId: testPrincipal().userId, groupId: null, name: "Old", type: "checking", currency: "EUR",
      origin: "synced", provider: "wallet", status: "active", includeInNetWorth: true, notes: null, sortOrder: 2,
    });
    const bare = await deps.accounts.create({
      userId: testPrincipal().userId, groupId: null, name: "Bare", type: "checking", currency: "EUR",
      origin: "synced", provider: "wallet", status: "active", includeInNetWorth: true, notes: null, sortOrder: 3,
    });
    await deps.accounts.recordBalances([
      { accountId: fresh.id, asOf: "2026-09-01", balance: "1.00", available: null, source: "provider", capturedAt: new Date(now.getTime() - 35 * 3_600_000) },
      { accountId: old.id, asOf: "2026-08-20", balance: "2.00", available: null, source: "provider", capturedAt: new Date(now.getTime() - 37 * 3_600_000) },
    ]);
    const items = await listAccounts(deps)(testPrincipal());
    const stale = Object.fromEntries(items.map((i) => [i.account.id, i.stale]));
    expect(stale).toEqual({ [manual.id]: false, [fresh.id]: false, [old.id]: true, [bare.id]: true });
  });

  it("builds a 13-month trend that carries the last known balance forward", async () => {
    const { deps } = harness();
    await createManualAccount(deps)(testPrincipal(), {
      name: "Cash", type: "cash", openingBalance: { asOf: "2026-08-31", balance: "100.00" },
    });
    const [item] = await listAccounts(deps)(testPrincipal());
    expect(item?.trend).toHaveLength(13);
    expect(item?.trend.at(0)).toEqual({ month: "2025-09-01", value: null });
    expect(item?.trend.at(-2)).toEqual({ month: "2026-08-01", value: 100 });
    expect(item?.trend.at(-1)).toEqual({ month: "2026-09-01", value: 100 });
    const [shorter] = await listAccounts(deps)(testPrincipal(), { months: 3 });
    expect(shorter?.trend.map((p) => p.month)).toEqual(["2026-07-01", "2026-08-01", "2026-09-01"]);
  });

  it("returns the detail with history newest first and the provider link", async () => {
    const { deps } = harness();
    const synced = await deps.accounts.create({
      userId: testPrincipal().userId, groupId: null, name: "ING", type: "checking", currency: "EUR",
      origin: "synced", provider: "wallet", status: "active", includeInNetWorth: true, notes: null, sortOrder: 0,
    });
    await deps.links.upsertSeen(
      testPrincipal().userId,
      { provider: "wallet", entityType: "account", entityId: synced.id, externalId: "ext-1", metadata: {} },
      new Date(),
    );
    await deps.accounts.recordBalances([
      { accountId: synced.id, asOf: "2026-08-01", balance: "1.00", available: null, source: "provider", capturedAt: deps.clock.now() },
      { accountId: synced.id, asOf: "2026-09-01", balance: "2.00", available: null, source: "provider", capturedAt: deps.clock.now() },
    ]);
    const detail = await getAccountDetail(deps)(testPrincipal(), synced.id);
    expect(detail.history.map((p) => p.asOf)).toEqual(["2026-09-01", "2026-08-01"]);
    expect(detail.latest?.balance).toBe("2.00");
    expect(detail.series).toHaveLength(13);
    expect(detail.link?.externalId).toBe("ext-1");
    expect(detail.stale).toBe(false);
  });

  it("hides another user's account from the detail view", async () => {
    const { deps } = harness();
    const a = await createManualAccount(deps)(testPrincipal(), { name: "x", type: "cash" });
    const other = testPrincipal({ userId: "00000000-0000-7000-8000-000000000002" });
    await expect(getAccountDetail(deps)(other, a.id)).rejects.toThrow(/not found/i);
  });

  it("rejects a blank name and a future opening balance", async () => {
    const { deps } = harness();
    await expect(createManualAccount(deps)(testPrincipal(), { name: "  ", type: "cash" })).rejects.toThrow(
      InvalidInputError,
    );
    await expect(
      createManualAccount(deps)(testPrincipal(), {
        name: "x", type: "cash", openingBalance: { asOf: "2026-09-03", balance: "1" },
      }),
    ).rejects.toThrow(/future/);
  });
});
