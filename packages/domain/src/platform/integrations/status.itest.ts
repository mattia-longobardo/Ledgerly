// The state of a connection in the database (rewrite plan, N2): what closing a run writes about
// the connection, who can read which run, the runs nobody is running any more, and the warnings
// the dispatcher sends after a pass.
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Ctx } from "../context";
import { getDb } from "../db/client";
import { notificationsLog } from "../notifications/schema";
import { APP_VERSION } from "../version";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { createTestUser } from "../../../../../test/users";
import {
  CONSENT_EXPIRING,
  reportConnection,
  SYNC_FAILED,
  SYNC_STALE,
} from "../../../../../apps/web/src/platform/integrations/alerts";
import { asAutomatic } from "./origin";
import { integrationConnections, syncRuns } from "./schema";
import {
  clearErrorCode,
  closeOrphanRuns,
  type Connection,
  findConnection,
  finishRun,
  listRuns,
  makeDueNow,
  markConnection,
  recentRuns,
  recordRun,
  saveConnection,
  savePluginConnection,
  saveSchedule,
} from "./service";
import { TREK_PROVIDER, WALLET_PROVIDER } from "../../../../../test/fixtures/providers";

const NOW = new Date("2026-11-15T12:00:00Z");
const minutes = (count: number) => new Date(NOW.getTime() + count * 60_000);
const BANKS = "plugin:enablebanking";

async function newPerson(): Promise<{ ctx: Ctx; person: { id: string; email: string } }> {
  const user = await createTestUser();
  return {
    person: { id: user.id, email: user.email },
    ctx: {
      userId: user.id,
      role: "user",
      locale: "en",
      timeZone: "Europe/Rome",
      numberFormat: "it-IT",
      displayCurrency: "EUR",
    },
  };
}

const wallet = (ctx: Ctx) =>
  saveConnection(ctx, { provider: WALLET_PROVIDER, credentials: { token: "t-1" } });

/** One run of a connection, opened and closed. */
async function run(
  ctx: Ctx,
  connection: Connection,
  kind: "accounts" | "transactions",
  outcome: { error?: string; cause?: unknown } = {},
  at: Date = NOW,
): Promise<void> {
  const opened = await recordRun(ctx, { connectionId: connection.id, kind });
  await finishRun(ctx, opened.id, { counts: {}, ...outcome }, at);
}

const reread = async (ctx: Ctx, connection: Connection) =>
  (await findConnection(ctx, connection.id)) as Connection;

async function warnings(userId: string): Promise<[string, string][]> {
  const rows = await getDb()
    .select({ kind: notificationsLog.kind, key: notificationsLog.key })
    .from(notificationsLog)
    .where(eq(notificationsLog.userId, userId))
    .orderBy(asc(notificationsLog.kind), asc(notificationsLog.key));
  return rows.map((row) => [row.kind, row.key]);
}

beforeEach(resetDatabase);
afterAll(closeDatabase);

describe("closing a run", () => {
  it("keeps the code, the HTTP status, who started it and the app's version, never the cause", async () => {
    const { ctx } = await newPerson();
    const connection = await wallet(ctx);
    const cause = Object.assign(new Error("the provider said: SECRET-9c1"), { kind: "http", status: 503 });
    await asAutomatic(() => run(ctx, connection, "transactions", { error: "HTTP 503", cause }));
    await run(ctx, connection, "accounts");

    const rows = await getDb().select().from(syncRuns).orderBy(asc(syncRuns.kind));
    expect(
      rows.map((row) => [row.kind, row.state, row.origin, row.errorCode, row.httpStatus, row.appVersion]),
    ).toEqual([
      ["accounts", "success", "manual", null, null, APP_VERSION],
      ["transactions", "failed", "auto", "provider_down", 503, APP_VERSION],
    ]);
    expect(JSON.stringify(rows)).not.toContain("SECRET-9c1");
  });

  it("counts the failures in a row on the connection, and forgets them at a good reading", async () => {
    const { ctx } = await newPerson();
    const connection = await wallet(ctx);
    const down = { error: "down", cause: { kind: "network" } };
    for (const step of [1, 2, 3]) {
      // The balances work and the movements fail: the pass failed, three times.
      await run(ctx, connection, "accounts", {}, minutes(step * 60));
      await run(ctx, connection, "transactions", down, minutes(step * 60 + 1));
      expect(await reread(ctx, connection)).toMatchObject({
        consecutiveFailures: step,
        errorCode: "provider_down",
      });
    }
    await run(ctx, connection, "transactions", {}, minutes(300));
    expect(await reread(ctx, connection)).toMatchObject({
      state: "active",
      consecutiveFailures: 0,
      errorCode: null,
    });
  });

  it("does not count a provider that asked to wait (decision Q2)", async () => {
    const { ctx } = await newPerson();
    const connection = await wallet(ctx);
    for (const step of [1, 2, 3]) {
      await run(ctx, connection, "transactions", { error: "rate_limited" }, minutes(step));
    }
    expect(await reread(ctx, connection)).toMatchObject({
      consecutiveFailures: 0,
      errorCode: "rate_limited",
    });
  });

  it("has no code for a failure nobody can place", async () => {
    const { ctx } = await newPerson();
    const connection = await wallet(ctx);
    await run(ctx, connection, "transactions", { error: "3 of 5 changes did not arrive" });
    expect(await reread(ctx, connection)).toMatchObject({
      state: "error",
      consecutiveFailures: 1,
      errorCode: null,
    });
  });

  it("marks a refused credential, and a new one clears everything", async () => {
    const { ctx } = await newPerson();
    const connection = await wallet(ctx);
    await run(ctx, connection, "transactions", {
      error: "401",
      cause: { kind: "token_rejected", status: 401 },
    });
    await markConnection(ctx, connection.id, "revoked", "token rejected", NOW);
    expect(await reread(ctx, connection)).toMatchObject({
      state: "revoked",
      errorCode: "auth",
      consecutiveFailures: 1,
    });

    await wallet(ctx);
    expect(await reread(ctx, connection)).toMatchObject({
      state: "active",
      errorCode: null,
      consecutiveFailures: 0,
    });
  });

  it("forgets the code of a key the person replaced, on every connection it opens", async () => {
    const { ctx } = await newPerson();
    const bank = (name: string) =>
      savePluginConnection(ctx, {
        provider: BANKS,
        instanceKey: `IT:${name}`,
        credentials: { a: "1" },
        expiresAt: null,
      });
    const [first, second] = [await bank("Alfa"), await bank("Beta")];
    for (const one of [first, second]) await run(ctx, one, "transactions", { error: "auth" });
    const other = await wallet(ctx);
    await run(ctx, other, "transactions", { error: "401", cause: { kind: "token_rejected" } });

    await clearErrorCode(ctx, BANKS, "auth");
    expect((await reread(ctx, first)).errorCode).toBeNull();
    expect((await reread(ctx, second)).errorCode).toBeNull();
    expect((await reread(ctx, other)).errorCode).toBe("auth");
  });
});

describe("the runs of a person", () => {
  it("are read by that person only: an id of somebody else's is an id that is not there", async () => {
    const { ctx: mine } = await newPerson();
    const { ctx: theirs } = await newPerson();
    const [own, foreign] = [await wallet(mine), await wallet(theirs)];
    await run(mine, own, "transactions");
    await run(theirs, foreign, "transactions");
    await run(theirs, foreign, "accounts");

    expect(await findConnection(mine, foreign.id)).toBeNull();
    expect(await findConnection(mine, "not-a-uuid")).toBeNull();
    expect(await listRuns(mine, { connectionId: foreign.id })).toEqual([]);
    expect(await listRuns(mine)).toHaveLength(1);
    const since = new Date(0);
    expect((await recentRuns(mine, 40, since)).map((one) => one.connectionId)).toEqual([own.id]);
    expect(await recentRuns(theirs, 40, since)).toHaveLength(2);
  });

  it("are at most so many per connection, newest first, and not older than the window", async () => {
    const { ctx } = await newPerson();
    const first = await wallet(ctx);
    const second = await saveConnection(ctx, {
      provider: TREK_PROVIDER,
      credentials: { baseUrl: "https://t.example", clientId: "c", clientSecret: "s" },
    });
    const at = (connection: Connection, offset: number) =>
      getDb()
        .insert(syncRuns)
        .values({
          userId: ctx.userId,
          connectionId: connection.id,
          kind: "transactions",
          state: "success",
          startedAt: minutes(offset),
          finishedAt: minutes(offset),
        });
    for (const offset of [-5, -4, -3, -2, -1]) await at(first, offset);
    await at(second, -10);
    await at(second, -60 * 24 * 40);

    const runs = await recentRuns(ctx, 3, minutes(-60 * 24 * 30));
    expect(runs.map((one) => [one.connectionId === first.id ? "first" : "second", one.startedAt])).toEqual([
      ["first", minutes(-1)],
      ["first", minutes(-2)],
      ["first", minutes(-3)],
      ["second", minutes(-10)],
    ]);
    expect(await listRuns(ctx, { since: minutes(-3) })).toHaveLength(3);
  });

  it("are closed as orphans after an hour, with their reason, and no later", async () => {
    const { ctx } = await newPerson();
    const connection = await wallet(ctx);
    const open = (kind: "accounts" | "transactions", offset: number) =>
      getDb()
        .insert(syncRuns)
        .values({
          userId: ctx.userId,
          connectionId: connection.id,
          kind,
          state: "running",
          startedAt: minutes(offset),
        });
    await open("accounts", -61);
    await open("transactions", -59);

    expect(await closeOrphanRuns(NOW)).toBe(1);
    expect(await closeOrphanRuns(NOW)).toBe(0);
    const rows = await getDb().select().from(syncRuns).orderBy(asc(syncRuns.kind));
    expect(rows.map((row) => [row.kind, row.state, row.error, row.finishedAt])).toEqual([
      ["accounts", "failed", "orphaned", NOW],
      ["transactions", "running", null, null],
    ]);
    expect(await reread(ctx, connection)).toMatchObject({ state: "active", consecutiveFailures: 0 });
  });
});

describe("the connections of a provider", () => {
  it("are as many as the person connects: the key on the provider alone is gone", async () => {
    const { ctx } = await newPerson();
    const bank = (name: string, expiresAt: Date | null = null) =>
      savePluginConnection(ctx, {
        provider: BANKS,
        instanceKey: `IT:${name}`,
        credentials: { a: "1" },
        expiresAt,
      });
    const first = await bank("Alfa");
    const second = await bank("Beta");
    expect(second.id).not.toBe(first.id);
    // The same bank again is the same connection, with its new access.
    const renewed = await bank("Alfa", minutes(60));
    expect(renewed.id).toBe(first.id);
    expect(await getDb().select({ id: integrationConnections.id }).from(integrationConnections)).toHaveLength(
      2,
    );
  });

  it("are due at once when the person turns the provider on again, the scheduled ones only", async () => {
    const { ctx } = await newPerson();
    const bank = (name: string) =>
      savePluginConnection(ctx, {
        provider: BANKS,
        instanceKey: `IT:${name}`,
        credentials: { a: "1" },
        expiresAt: null,
      });
    const [scheduled, manual] = [await bank("Alfa"), await bank("Beta")];
    await saveSchedule(
      ctx,
      scheduled.id,
      { rules: [{ kind: "times", times: ["07:10"], days: { kind: "every" } }] },
      { now: NOW },
    );
    const other = await wallet(ctx);
    const before = (await reread(ctx, other)).nextSyncAt;

    await makeDueNow(ctx, BANKS, NOW);
    expect((await reread(ctx, scheduled)).nextSyncAt).toEqual(NOW);
    expect((await reread(ctx, manual)).nextSyncAt).toBeNull();
    expect((await reread(ctx, other)).nextSyncAt).toEqual(before);
  });
});

describe("the warnings after a pass (ux §6)", () => {
  const down = { error: "down", cause: { kind: "network" } };

  it("come at the third failure in a row, once, and go when the connection is up to date", async () => {
    const { ctx, person } = await newPerson();
    const connection = await wallet(ctx);
    await run(ctx, connection, "transactions", {}, minutes(-10));
    for (const step of [1, 2]) {
      await run(ctx, connection, "transactions", down, minutes(step));
      await reportConnection(person, ctx, await reread(ctx, connection), minutes(step));
    }
    expect(await warnings(person.id)).toEqual([]);

    await run(ctx, connection, "transactions", down, minutes(3));
    await reportConnection(person, ctx, await reread(ctx, connection), minutes(3));
    await run(ctx, connection, "transactions", down, minutes(4));
    await reportConnection(person, ctx, await reread(ctx, connection), minutes(4));
    expect(await warnings(person.id)).toEqual([[SYNC_FAILED, connection.id]]);

    await run(ctx, connection, "transactions", {}, minutes(5));
    await reportConnection(person, ctx, await reread(ctx, connection), minutes(5));
    expect(await warnings(person.id)).toEqual([]);
  });

  it("say a connection is stale when nothing has worked for longer than the window", async () => {
    const { ctx, person } = await newPerson();
    const connection = await wallet(ctx);
    await run(ctx, connection, "transactions", {}, minutes(-37 * 60));
    await getDb()
      .update(integrationConnections)
      .set({ nextSyncAt: minutes(30) })
      .where(and(eq(integrationConnections.id, connection.id)));
    await reportConnection(person, ctx, await reread(ctx, connection), NOW);
    expect(await warnings(person.id)).toEqual([[SYNC_STALE, connection.id]]);
  });

  it("say the end of an access 14 days and 3 days before it, once each, and again for a new end", async () => {
    const { ctx, person } = await newPerson();
    const days = (count: number) => minutes(count * 24 * 60);
    const bank = (expiresAt: Date) =>
      savePluginConnection(ctx, {
        provider: BANKS,
        instanceKey: "IT:Alfa",
        credentials: { a: "1" },
        expiresAt,
      });
    const connection = await bank(days(20));
    await saveSchedule(
      ctx,
      connection.id,
      { rules: [{ kind: "times", times: ["07:10"], days: { kind: "every" } }] },
      { now: NOW },
    );
    await run(ctx, connection, "transactions", {}, NOW);
    // A reading that works just before each report: the only thing to say is the end of the access.
    const report = async (at: Date) => {
      await run(ctx, connection, "transactions", {}, at);
      return reportConnection(person, ctx, await reread(ctx, connection), at);
    };
    const end = days(20).toISOString().slice(0, 10);

    await report(days(1));
    expect(await warnings(person.id)).toEqual([]);
    await report(days(7));
    await report(days(8));
    expect(await warnings(person.id)).toEqual([[CONSENT_EXPIRING, `${connection.id}:14:${end}`]]);
    await report(days(18));
    await report(days(19));
    expect(await warnings(person.id)).toEqual([
      [CONSENT_EXPIRING, `${connection.id}:14:${end}`],
      [CONSENT_EXPIRING, `${connection.id}:3:${end}`],
    ]);

    // A renewed access has a new end: its own warnings.
    await bank(days(22));
    await report(days(20));
    expect(await warnings(person.id)).toHaveLength(3);
  });
});
