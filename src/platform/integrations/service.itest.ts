import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Ctx } from "@/platform/context";
import { getDb } from "@/platform/db/client";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { createTestUser } from "../../../test/users";
import { type ProviderLink, WALLET_PROVIDER } from "./rules";
import { integrationConnections, providerLinks } from "./schema";
import {
  type Connection,
  deleteConnection,
  finishRun,
  IntegrationError,
  linkExternal,
  listConnections,
  listRuns,
  markConnection,
  readCredentials,
  readSyncJob,
  recordRun,
  resolveExternal,
  saveConnection,
  saveSyncJob,
  skipRun,
  unlinkEntities,
} from "./service";

function contextFor(userId: string): Ctx {
  return {
    userId,
    role: "user",
    locale: "en",
    timeZone: "Europe/Rome",
    numberFormat: "it-IT",
  };
}

async function newContext(): Promise<Ctx> {
  return contextFor((await createTestUser()).id);
}

const TOKEN = "wallet-token-2f6b1c";
const CREDENTIALS = { token: TOKEN, baseUrl: "https://rest.budgetbakers.com/wallet/v1/api" };

const NOW = new Date("2026-03-10T08:07:00Z");
const hoursAfter = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000);

/** Reads the sealed column directly: the service deliberately never selects it. */
async function sealedCredentials(ctx: Ctx, connectionId: string): Promise<Buffer> {
  const [row] = await getDb()
    .select({ credentials: integrationConnections.credentials })
    .from(integrationConnections)
    .where(and(eq(integrationConnections.id, connectionId), eq(integrationConnections.userId, ctx.userId)));
  return row.credentials;
}

async function storedLink(ctx: Ctx, externalId: string) {
  const [row] = await getDb()
    .select()
    .from(providerLinks)
    .where(and(eq(providerLinks.userId, ctx.userId), eq(providerLinks.externalId, externalId)));
  return row;
}

function transactionLink(over: Partial<ProviderLink> = {}): ProviderLink {
  return {
    provider: WALLET_PROVIDER,
    entityType: "transaction",
    entityId: randomUUID(),
    externalId: "w-1",
    ...over,
  };
}

let ctx: Ctx;

beforeEach(async () => {
  await resetDatabase();
  ctx = await newContext();
});

afterAll(closeDatabase);

async function walletConnection(on: Ctx = ctx): Promise<Connection> {
  return saveConnection(on, { provider: WALLET_PROVIDER, credentials: CREDENTIALS });
}

describe("saveConnection", () => {
  it("seals the credentials and never hands them back with the connection", async () => {
    const connection = await walletConnection();
    expect(connection).toMatchObject({ provider: WALLET_PROVIDER, state: "active", lastError: null });
    expect(connection.lastOkAt).toBeNull();
    expect(connection).not.toHaveProperty("credentials");

    const sealed = await sealedCredentials(ctx, connection.id);
    expect(sealed.includes(TOKEN)).toBe(false);
    expect(sealed.toString("utf8")).not.toContain("budgetbakers");
  });

  it("round-trips the credentials through readCredentials and nowhere else", async () => {
    const connection = await walletConnection();
    expect(await readCredentials(ctx, connection.id)).toEqual(CREDENTIALS);
    expect(await listConnections(ctx)).toEqual([connection]);
  });

  it("replaces the credentials of the one connection a provider gets, keeping its identity", async () => {
    const first = await walletConnection();
    await markConnection(ctx, first.id, "revoked", "token rejected");
    const again = await saveConnection(ctx, {
      provider: WALLET_PROVIDER,
      credentials: { token: "fresh-token" },
    });

    expect(again.id).toBe(first.id);
    expect(again).toMatchObject({ state: "active", lastError: null });
    expect(await readCredentials(ctx, again.id)).toEqual({ token: "fresh-token" });
    expect(await listConnections(ctx)).toHaveLength(1);
  });

  it("refuses an unknown provider and an unusable credential bag, writing nothing", async () => {
    await expect(saveConnection(ctx, { provider: "monzo", credentials: CREDENTIALS })).rejects.toThrow(
      IntegrationError,
    );
    await expect(
      saveConnection(ctx, { provider: WALLET_PROVIDER, credentials: { token: "" } }),
    ).rejects.toThrow(IntegrationError);
    expect(await listConnections(ctx)).toEqual([]);
  });
});

describe("deleteConnection", () => {
  it("takes the credentials and the sync history, and leaves the links standing", async () => {
    const connection = await walletConnection();
    const run = await recordRun(ctx, { connectionId: connection.id, kind: "transactions" });
    await finishRun(ctx, run.id, { counts: { created: 1 } }, NOW);
    const link = transactionLink();
    await linkExternal(ctx, link);

    await deleteConnection(ctx, connection.id);

    expect(await listConnections(ctx)).toEqual([]);
    expect(await listRuns(ctx)).toEqual([]);
    expect(await readSyncJob(ctx, connection.id, "transactions")).toBeNull();
    expect(await resolveExternal(ctx, WALLET_PROVIDER, "transaction", ["w-1"])).toEqual(
      new Map([["w-1", link.entityId]]),
    );
  });

  it("reports a connection that is not there", async () => {
    await expect(deleteConnection(ctx, randomUUID())).rejects.toThrow(IntegrationError);
  });
});

describe("recordRun and finishRun", () => {
  it("closes a successful run, schedules the next pass and marks the connection healthy", async () => {
    const connection = await walletConnection();
    const run = await recordRun(ctx, { connectionId: connection.id, kind: "transactions" });
    expect(run).toMatchObject({ state: "running", kind: "transactions", finishedAt: null });

    await finishRun(ctx, run.id, { counts: { created: 3, updated: 1.4, broken: Number.NaN } }, NOW);

    const [stored] = await listRuns(ctx, { connectionId: connection.id });
    expect(stored).toMatchObject({ state: "success", error: null, finishedAt: NOW });
    expect(stored.counts).toEqual({ created: 3, updated: 1 });

    const job = await readSyncJob(ctx, connection.id, "transactions");
    expect(job).toMatchObject({ lastRunAt: NOW, nextRunAt: hoursAfter(1), cursor: null });

    const [health] = await listConnections(ctx);
    expect(health).toMatchObject({ state: "active", lastOkAt: NOW, lastError: null });
  });

  it("closes a failed run on the connection as well, on one line", async () => {
    const connection = await walletConnection();
    const run = await recordRun(ctx, { connectionId: connection.id, kind: "accounts" });
    await finishRun(ctx, run.id, { counts: {} }, NOW);
    const second = await recordRun(ctx, { connectionId: connection.id, kind: "accounts" });
    await finishRun(ctx, second.id, { counts: {}, error: "wallet said\n  no" }, hoursAfter(1));

    const [stored] = await listRuns(ctx, { connectionId: connection.id });
    expect(stored).toMatchObject({ state: "failed", error: "wallet said no" });

    const [health] = await listConnections(ctx);
    // The last time it worked stays on the row: it is a fact, not an opinion about now.
    expect(health).toMatchObject({ state: "error", lastError: "wallet said no", lastOkAt: NOW });
  });

  it("does not talk a revoked connection back into a plain error", async () => {
    const connection = await walletConnection();
    await markConnection(ctx, connection.id, "revoked", "token rejected");
    const run = await recordRun(ctx, { connectionId: connection.id, kind: "accounts" });
    await finishRun(ctx, run.id, { counts: {}, error: "connection reset" }, NOW);

    const [health] = await listConnections(ctx);
    expect(health).toMatchObject({ state: "revoked", lastError: "token rejected" });
  });

  it("refuses to close a run twice, or to open one on someone else's connection", async () => {
    const connection = await walletConnection();
    const run = await recordRun(ctx, { connectionId: connection.id, kind: "accounts" });
    await finishRun(ctx, run.id, { counts: {} }, NOW);
    await expect(finishRun(ctx, run.id, { counts: {} }, NOW)).rejects.toThrow(IntegrationError);
    await expect(recordRun(ctx, { connectionId: randomUUID(), kind: "accounts" })).rejects.toThrow(
      IntegrationError,
    );
  });

  it("lists the runs newest first", async () => {
    const connection = await walletConnection();
    const first = await recordRun(ctx, { connectionId: connection.id, kind: "accounts" });
    await finishRun(ctx, first.id, { counts: {} }, NOW);
    const second = await recordRun(ctx, { connectionId: connection.id, kind: "transactions" });

    expect((await listRuns(ctx)).map((run) => run.id)).toEqual([second.id, first.id]);
    expect(await listRuns(ctx, { limit: 1 })).toHaveLength(1);
  });
});

describe("skipRun", () => {
  it("records a run that had nothing to attempt, and leaves the connection and schedule alone", async () => {
    const connection = await walletConnection();
    await markConnection(ctx, connection.id, "revoked", "token rejected");
    const run = await recordRun(ctx, { connectionId: connection.id, kind: "transactions" });

    await skipRun(ctx, run.id, "connection revoked", NOW);

    const [stored] = await listRuns(ctx, { connectionId: connection.id });
    expect(stored).toMatchObject({ state: "skipped", finishedAt: NOW, error: "connection revoked" });
    expect(stored.counts).toEqual({});
    // Nothing was read, so nothing was learned: the connection keeps its state and the next pass
    // is still owed at the time it was already due.
    const [health] = await listConnections(ctx);
    expect(health).toMatchObject({ state: "revoked", lastError: "token rejected", lastOkAt: null });
    expect(await readSyncJob(ctx, connection.id, "transactions")).toBeNull();
  });

  it("takes no reason at all, and refuses to close a run twice", async () => {
    const connection = await walletConnection();
    const run = await recordRun(ctx, { connectionId: connection.id, kind: "accounts" });
    await skipRun(ctx, run.id, undefined, NOW);

    const [stored] = await listRuns(ctx);
    expect(stored).toMatchObject({ state: "skipped", error: null });
    await expect(skipRun(ctx, run.id, "again", NOW)).rejects.toThrow(IntegrationError);
    await expect(finishRun(ctx, run.id, { counts: {} }, NOW)).rejects.toThrow(IntegrationError);
  });
});

describe("sync jobs", () => {
  it("writes a cursor without disturbing the schedule, and back again", async () => {
    const connection = await walletConnection();
    const run = await recordRun(ctx, { connectionId: connection.id, kind: "transactions" });
    await finishRun(ctx, run.id, { counts: {} }, NOW);

    await saveSyncJob(ctx, connection.id, "transactions", { cursor: { since: "2026-03-01" } });
    let job = await readSyncJob(ctx, connection.id, "transactions");
    expect(job).toMatchObject({ cursor: { since: "2026-03-01" }, lastRunAt: NOW, nextRunAt: hoursAfter(1) });

    await saveSyncJob(ctx, connection.id, "transactions", { nextRunAt: hoursAfter(6) });
    job = await readSyncJob(ctx, connection.id, "transactions");
    expect(job).toMatchObject({ cursor: { since: "2026-03-01" }, nextRunAt: hoursAfter(6) });
  });

  it("creates the row on first use and refuses a connection that is not the user's", async () => {
    const connection = await walletConnection();
    const job = await saveSyncJob(ctx, connection.id, "accounts", { cursor: null });
    expect(job).toMatchObject({ kind: "accounts", cursor: null, nextRunAt: null, lastRunAt: null });
    await expect(saveSyncJob(ctx, randomUUID(), "accounts", { cursor: null })).rejects.toThrow(
      IntegrationError,
    );
  });
});

describe("linkExternal and resolveExternal", () => {
  it("keeps the first sighting and moves the last one, so a repeated sync writes one row", async () => {
    const link = transactionLink({ metadata: { payee: "Esselunga" } });
    await linkExternal(ctx, link, NOW);
    await linkExternal(ctx, { ...link, metadata: undefined }, hoursAfter(1));

    const stored = await storedLink(ctx, "w-1");
    expect(stored).toMatchObject({
      entityId: link.entityId,
      firstSeenAt: NOW,
      lastSeenAt: hoursAfter(1),
      missingSince: null,
      // A sync that carries no metadata does not erase what an earlier one knew.
      metadata: { payee: "Esselunga" },
    });
  });

  it("maps a provider's ids to the local entities, ignoring other kinds and providers", async () => {
    const transaction = transactionLink({ externalId: "w-1" });
    const account = transactionLink({ externalId: "w-1", entityType: "account" });
    await linkExternal(ctx, transaction);
    await linkExternal(ctx, account);

    expect(await resolveExternal(ctx, WALLET_PROVIDER, "transaction", ["w-1", "w-2"])).toEqual(
      new Map([["w-1", transaction.entityId]]),
    );
    expect(await resolveExternal(ctx, WALLET_PROVIDER, "account", ["w-1"])).toEqual(
      new Map([["w-1", account.entityId]]),
    );
    expect(await resolveExternal(ctx, "trek", "transaction", ["w-1"]).then((m) => m.size)).toBe(0);
    expect(await resolveExternal(ctx, WALLET_PROVIDER, "transaction", [])).toEqual(new Map());
  });

  it("refuses to let two of a provider's ids claim the same local entity", async () => {
    const link = transactionLink();
    await linkExternal(ctx, link);
    await expect(linkExternal(ctx, { ...link, externalId: "w-2" })).rejects.toThrow(IntegrationError);
    expect(await resolveExternal(ctx, WALLET_PROVIDER, "transaction", ["w-1", "w-2"])).toEqual(
      new Map([["w-1", link.entityId]]),
    );
  });

  it("follows a provider id that moves to another local entity", async () => {
    const link = transactionLink();
    await linkExternal(ctx, link);
    const moved = randomUUID();
    await linkExternal(ctx, { ...link, entityId: moved });
    expect(await resolveExternal(ctx, WALLET_PROVIDER, "transaction", ["w-1"])).toEqual(
      new Map([["w-1", moved]]),
    );
  });

  it("refuses a link it cannot make sense of", async () => {
    await expect(linkExternal(ctx, transactionLink({ entityId: "not-a-uuid" }))).rejects.toThrow(
      IntegrationError,
    );
    await expect(resolveExternal(ctx, WALLET_PROVIDER, "payslip", ["w-1"])).rejects.toThrow(IntegrationError);
  });
});

describe("linkExternal inside the caller's transaction", () => {
  it("leaves no link behind when the caller rolls back", async () => {
    const link = transactionLink();
    await expect(
      getDb().transaction(async (tx) => {
        await linkExternal(ctx, link, NOW, tx);
        throw new Error("the caller changed its mind");
      }),
    ).rejects.toThrow("the caller changed its mind");

    // The sink of spec §4.2: the row and its link share one fate, so the next pass sees neither
    // a duplicate to create nor an entity it cannot recognise.
    expect(await storedLink(ctx, "w-1")).toBeUndefined();
    expect(await resolveExternal(ctx, WALLET_PROVIDER, "transaction", ["w-1"])).toEqual(new Map());
  });

  it("commits with the caller", async () => {
    const link = transactionLink();
    await getDb().transaction(async (tx) => {
      await linkExternal(ctx, link, NOW, tx);
    });
    expect(await resolveExternal(ctx, WALLET_PROVIDER, "transaction", ["w-1"])).toEqual(
      new Map([["w-1", link.entityId]]),
    );
  });

  it("still reports a conflicting link, and takes the caller's transaction down with it", async () => {
    const first = transactionLink();
    await linkExternal(ctx, first, NOW);

    await expect(
      getDb().transaction(async (tx) => {
        await linkExternal(ctx, { ...first, externalId: "w-2" }, NOW, tx);
      }),
    ).rejects.toThrow(IntegrationError);

    expect(await resolveExternal(ctx, WALLET_PROVIDER, "transaction", ["w-1", "w-2"])).toEqual(
      new Map([["w-1", first.entityId]]),
    );
  });
});

describe("unlinkEntities", () => {
  it("forgets the links of entities that no longer exist here", async () => {
    const link = transactionLink();
    await linkExternal(ctx, link);
    expect(await unlinkEntities(ctx, WALLET_PROVIDER, "transaction", [link.entityId])).toBe(1);
    expect(await resolveExternal(ctx, WALLET_PROVIDER, "transaction", ["w-1"])).toEqual(new Map());
    expect(await unlinkEntities(ctx, WALLET_PROVIDER, "transaction", [])).toBe(0);
  });
});

/** Spec §4.4 and §11: user B reads, changes, deletes and references nothing of user A's. */
describe("isolation between users", () => {
  let other: Ctx;
  let connection: Connection;

  beforeEach(async () => {
    other = await newContext();
    connection = await walletConnection();
  });

  it("does not read A's connections, credentials or runs", async () => {
    const run = await recordRun(ctx, { connectionId: connection.id, kind: "accounts" });
    await finishRun(ctx, run.id, { counts: { created: 1 } }, NOW);

    expect(await listConnections(other)).toEqual([]);
    expect(await listRuns(other)).toEqual([]);
    expect(await listRuns(other, { connectionId: connection.id })).toEqual([]);
    expect(await readSyncJob(other, connection.id, "accounts")).toBeNull();
    await expect(readCredentials(other, connection.id)).rejects.toThrow(IntegrationError);
  });

  it("does not change A's connection, runs or schedule", async () => {
    const run = await recordRun(ctx, { connectionId: connection.id, kind: "accounts" });

    await expect(markConnection(other, connection.id, "revoked", "not yours")).rejects.toThrow(
      IntegrationError,
    );
    await expect(recordRun(other, { connectionId: connection.id, kind: "accounts" })).rejects.toThrow(
      IntegrationError,
    );
    await expect(finishRun(other, run.id, { counts: {}, error: "not yours" }, NOW)).rejects.toThrow(
      IntegrationError,
    );
    await expect(skipRun(other, run.id, "not yours", NOW)).rejects.toThrow(IntegrationError);
    await expect(saveSyncJob(other, connection.id, "accounts", { cursor: { x: "1" } })).rejects.toThrow(
      IntegrationError,
    );

    const [mine] = await listConnections(ctx);
    expect(mine).toMatchObject({ state: "active", lastError: null });
    const [stored] = await listRuns(ctx);
    expect(stored).toMatchObject({ id: run.id, state: "running", error: null });
  });

  it("does not delete A's connection", async () => {
    await expect(deleteConnection(other, connection.id)).rejects.toThrow(IntegrationError);
    expect(await listConnections(ctx)).toHaveLength(1);
    expect(await readCredentials(ctx, connection.id)).toEqual(CREDENTIALS);
  });

  it("does not reach A's data through a link of its own on the same ids", async () => {
    const mine = transactionLink();
    await linkExternal(ctx, mine, NOW);
    // B naming A's entity id writes a row of B's own: it neither blocks A's link nor shows up in A's.
    await linkExternal(other, { ...mine, externalId: "w-9" }, NOW);
    await linkExternal(other, transactionLink({ externalId: "w-1" }), NOW);

    expect(await resolveExternal(ctx, WALLET_PROVIDER, "transaction", ["w-1", "w-9"])).toEqual(
      new Map([["w-1", mine.entityId]]),
    );
    expect(await unlinkEntities(other, WALLET_PROVIDER, "transaction", [mine.entityId])).toBe(1);
    expect(await resolveExternal(ctx, WALLET_PROVIDER, "transaction", ["w-1"])).toEqual(
      new Map([["w-1", mine.entityId]]),
    );
  });

  it("gives each user their own connection for the same provider", async () => {
    const theirs = await saveConnection(other, {
      provider: WALLET_PROVIDER,
      credentials: { token: "their-token" },
    });
    expect(theirs.id).not.toBe(connection.id);
    expect(await readCredentials(other, theirs.id)).toEqual({ token: "their-token" });
    expect(await readCredentials(ctx, connection.id)).toEqual(CREDENTIALS);
  });
});
