import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { users } from "@/platform/auth/schema";
import type { Ctx } from "@/platform/context";
import { getDb } from "@/platform/db/client";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { newContext } from "../../../test/fixtures";
import { jobRuns } from "@/platform/jobs/schema";
import { runTier } from "@/platform/jobs/tick";
import { dispatchDueConnections, integrationsSyncJob } from "./jobs";
import { PAPERLESS_PROVIDER } from "./rules";
import { nextSyncTimes, type SyncSchedule } from "./schedule";
import { integrationConnections } from "./schema";
import {
  anyConnectionDue,
  dueConnections,
  IntegrationError,
  listConnections,
  markConnection,
  rescheduleConnections,
  saveConnection,
  saveSchedule,
} from "./service";

// The integrations dispatcher of docs/scheduler.md against a real database: a connection is passed
// when its own rules say so, to the minute, its next pass moves on, and `manual` is never due.

let ctx: Ctx;

beforeEach(async () => {
  await resetDatabase();
  ctx = await newContext();
  // A Paperless that answers with nothing: the pass is real, its content beside the point.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      return Response.json({
        next: null,
        results: url.pathname === "/api/document_types/" ? [{ id: 48, name: "Payroll" }] : [],
      });
    }),
  );
  await saveConnection(ctx, {
    provider: PAPERLESS_PROVIDER,
    credentials: { baseUrl: "http://paperless-ngx:8000", token: "t", payslipType: "Payroll" },
  });
});

afterEach(() => vi.unstubAllGlobals());
afterAll(closeDatabase);

describe("integrations-sync", () => {
  it("passes a new connection at once, then not again until its next slot", async () => {
    expect(await dueConnections()).toHaveLength(1);
    expect(await integrationsSyncJob.run()).toMatchObject({
      due: 1,
      passes: 1,
      failures: 0,
      provider_paperless: 1,
    });
    const [connection] = await listConnections(ctx);
    expect(connection.nextSyncAt).not.toBeNull();
    expect(connection.nextSyncAt!.getTime()).toBeGreaterThan(Date.now());
    expect(connection.nextSyncAt!.getUTCMinutes()).toBe(0);
    expect(await integrationsSyncJob.run()).toMatchObject({ due: 0, passes: 0 });
  });

  it("never passes a manual connection, and a saved schedule sets the next pass", async () => {
    const [connection] = await listConnections(ctx);
    const manual = await saveSchedule(ctx, connection.id, { rules: [] });
    expect(manual).toMatchObject({ schedule: { rules: [] }, nextSyncAt: null });
    expect(await dueConnections()).toHaveLength(0);

    const now = new Date("2026-11-10T05:00:00Z");
    const early = await saveSchedule(
      ctx,
      connection.id,
      { rules: [{ kind: "times", times: ["19:30", "06:43"], days: { kind: "every" } }] },
      now,
    );
    expect(early.schedule).toEqual({
      rules: [{ kind: "times", times: ["06:43", "19:30"], days: { kind: "every" } }],
    });
    // 06:43 in Rome, to the minute.
    expect(early.nextSyncAt).toEqual(new Date("2026-11-10T05:43:00Z"));
    expect(await dueConnections(new Date("2026-11-10T05:42:59Z"))).toHaveLength(0);
    expect(await dueConnections(new Date("2026-11-10T05:43:00Z"))).toHaveLength(1);
  });

  it("refuses a schedule that does not parse, runs too often or never runs", async () => {
    const [connection] = await listConnections(ctx);
    await expect(
      saveSchedule(ctx, connection.id, { mode: "interval", everyMinutes: 60 }),
    ).rejects.toMatchObject({ code: "invalid_schedule" });
    await expect(
      saveSchedule(ctx, connection.id, {
        rules: [
          { kind: "interval", everyMinutes: 5, from: "00:00", until: "23:59", days: { kind: "every" } },
        ],
      }),
    ).rejects.toBeInstanceOf(IntegrationError);
    await expect(
      saveSchedule(ctx, connection.id, {
        rules: [
          { kind: "times", times: ["06:43"], days: { kind: "every" } },
          { kind: "cron", expression: "50 6 * * *" },
        ],
      }),
    ).rejects.toMatchObject({ code: "invalid_schedule", problems: [{ code: "tooFrequent" }] });
    await expect(
      saveSchedule(ctx, connection.id, { rules: [{ kind: "cron", expression: "0 7 30 2 *" }] }),
    ).rejects.toMatchObject({ problems: [{ code: "neverRuns", rule: 0 }] });
    const other = await newContext();
    await expect(saveSchedule(other, connection.id, { rules: [] })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("passes a connection with combined rules at exactly the minutes its preview names", async () => {
    const [connection] = await listConnections(ctx);
    const schedule: SyncSchedule = {
      rules: [
        {
          kind: "interval",
          everyMinutes: 120,
          from: "08:10",
          until: "13:00",
          days: { kind: "weekdays", weekdays: [1, 2, 3, 4, 5] },
        },
        { kind: "times", times: ["06:43", "21:05"], days: { kind: "every" } },
        { kind: "cron", expression: "30 18 * * 6,7" },
      ],
    };
    // Friday 13 November 2026, 00:00 in Rome.
    const start = new Date("2026-11-12T23:00:00Z");
    await saveSchedule(ctx, connection.id, schedule, start);
    const preview = nextSyncTimes(schedule, ctx.timeZone, start, 11);

    // One tick a minute, as the cron sidecar does, for three days: to Sunday midnight.
    const passes: Date[] = [];
    for (let minute = 1; minute <= 72 * 60; minute += 1) {
      const now = new Date(start.getTime() + minute * 60_000);
      const detail = await dispatchDueConnections(now);
      if (Number(detail.due) > 0) passes.push(now);
    }
    expect(passes).toEqual(preview);
    expect(passes.map((at) => at.toISOString())).toEqual([
      "2026-11-13T05:43:00.000Z", // Fri 06:43
      "2026-11-13T07:10:00.000Z", // Fri 08:10
      "2026-11-13T09:10:00.000Z", // Fri 10:10
      "2026-11-13T11:10:00.000Z", // Fri 12:10
      "2026-11-13T20:05:00.000Z", // Fri 21:05
      "2026-11-14T05:43:00.000Z", // Sat 06:43
      "2026-11-14T17:30:00.000Z", // Sat 18:30 (cron)
      "2026-11-14T20:05:00.000Z", // Sat 21:05
      "2026-11-15T05:43:00.000Z", // Sun 06:43
      "2026-11-15T17:30:00.000Z", // Sun 18:30 (cron)
      "2026-11-15T20:05:00.000Z", // Sun 21:05
    ]);
  }, 120_000);

  it("leaves no trace on a minute with nothing due, and runs on one that has", async () => {
    const [connection] = await listConnections(ctx);
    await saveSchedule(ctx, connection.id, { rules: [] });
    expect(await anyConnectionDue()).toBe(false);
    expect(await runTier("minute", [integrationsSyncJob])).toEqual([]);
    expect(await getDb().select().from(jobRuns)).toHaveLength(0);

    await getDb()
      .update(integrationConnections)
      .set({ nextSyncAt: new Date(Date.now() - 30_000) })
      .where(eq(integrationConnections.id, connection.id));
    expect(await anyConnectionDue()).toBe(true);
    expect(await runTier("minute", [integrationsSyncJob])).toEqual([
      { job: "integrations-sync", status: "success" },
    ]);
    const [run] = await getDb().select().from(jobRuns);
    expect(run).toMatchObject({ tier: "minute", status: "success" });
  });

  it("migration 0034 keeps every D7 choice and the instants it ran at", async () => {
    const connections = [(await listConnections(ctx))[0]];
    for (const provider of ["wallet", "trek"]) {
      connections.push(await saveConnection(ctx, { provider, credentials: { token: "t" } }));
    }
    const legacy = [
      { mode: "interval", everyMinutes: 60 },
      { mode: "times", times: ["07:00", "19:30"] },
      { mode: "manual" },
    ];
    const migration = readFileSync(
      new URL("../../../drizzle/0034_sync_scheduler_v2.sql", import.meta.url),
      "utf8",
    );
    const update = migration.split("--> statement-breakpoint").find((one) => one.includes("UPDATE"))!;
    const db = getDb();
    await db.execute(
      sql`ALTER TABLE integration_connections DROP CONSTRAINT integration_connections_schedule_rules_ck`,
    );
    try {
      for (const [index, connection] of connections.entries()) {
        await db
          .update(integrationConnections)
          .set({ schedule: legacy[index] as unknown as SyncSchedule })
          .where(eq(integrationConnections.id, connection.id));
      }
      await db.execute(sql.raw(update));
    } finally {
      await db.execute(
        sql`ALTER TABLE integration_connections ADD CONSTRAINT integration_connections_schedule_rules_ck CHECK (jsonb_typeof(schedule->'rules') = 'array')`,
      );
    }
    const rows = await db
      .select({ id: integrationConnections.id, schedule: integrationConnections.schedule })
      .from(integrationConnections);
    const byId = new Map(rows.map((row) => [row.id, row.schedule]));
    expect(connections.map((connection) => byId.get(connection.id))).toEqual([
      {
        rules: [
          { kind: "interval", everyMinutes: 60, from: "00:00", until: "23:59", days: { kind: "every" } },
        ],
      },
      { rules: [{ kind: "times", times: ["07:00", "19:30"], days: { kind: "every" } }] },
      { rules: [] },
    ]);
  });

  it("skips a revoked connection and every connection of a banned person (PERS-49 SEC-08)", async () => {
    const [connection] = await listConnections(ctx);
    expect(await dueConnections()).toHaveLength(1);
    await markConnection(ctx, connection.id, "revoked", "Paperless refused the token");
    expect(await dueConnections()).toHaveLength(0);
    await markConnection(ctx, connection.id, "active");
    await getDb().update(users).set({ banned: true }).where(eq(users.id, ctx.userId));
    expect(await dueConnections()).toHaveLength(0);
    expect(await integrationsSyncJob.run()).toMatchObject({ due: 0, passes: 0 });
  });

  it("moves the next pass with the person's time zone", async () => {
    const [connection] = await listConnections(ctx);
    const now = new Date("2026-11-10T00:00:00Z");
    await saveSchedule(
      ctx,
      connection.id,
      { rules: [{ kind: "times", times: ["07:00"], days: { kind: "every" } }] },
      now,
    );
    await rescheduleConnections({ userId: ctx.userId, timeZone: "America/New_York" }, now);
    expect((await listConnections(ctx))[0].nextSyncAt).toEqual(new Date("2026-11-10T12:00:00Z"));
  });
});
