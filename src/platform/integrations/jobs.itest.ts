import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/platform/auth/schema";
import type { Ctx } from "@/platform/context";
import { getDb } from "@/platform/db/client";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { newContext } from "../../../test/fixtures";
import { integrationsSyncJob } from "./jobs";
import { PAPERLESS_PROVIDER } from "./rules";
import {
  dueConnections,
  IntegrationError,
  listConnections,
  markConnection,
  rescheduleConnections,
  saveConnection,
  saveSchedule,
} from "./service";

// The integrations dispatcher of docs/auth-design.md D7 against a real database: a connection is
// passed when its own schedule says so, its next pass moves on, and `manual` is never due.

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
    const manual = await saveSchedule(ctx, connection.id, { mode: "manual" });
    expect(manual).toMatchObject({ schedule: { mode: "manual" }, nextSyncAt: null });
    expect(await dueConnections()).toHaveLength(0);

    const now = new Date("2026-11-10T06:30:00Z");
    const times = await saveSchedule(ctx, connection.id, { mode: "times", times: ["19:30", "07:00"] }, now);
    expect(times.schedule).toEqual({ mode: "times", times: ["07:00", "19:30"] });
    expect(times.nextSyncAt).toEqual(new Date("2026-11-10T18:30:00Z"));
    expect(await dueConnections(new Date("2026-11-10T18:29:00Z"))).toHaveLength(0);
    expect(await dueConnections(new Date("2026-11-10T18:37:00Z"))).toHaveLength(1);
  });

  it("refuses a schedule that is not one of the three shapes", async () => {
    const [connection] = await listConnections(ctx);
    await expect(
      saveSchedule(ctx, connection.id, { mode: "interval", everyMinutes: 1 }),
    ).rejects.toBeInstanceOf(IntegrationError);
    const other = await newContext();
    await expect(saveSchedule(other, connection.id, { mode: "manual" })).rejects.toMatchObject({
      code: "not_found",
    });
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
    await saveSchedule(ctx, connection.id, { mode: "times", times: ["07:00"] }, now);
    await rescheduleConnections({ userId: ctx.userId, timeZone: "America/New_York" }, now);
    expect((await listConnections(ctx))[0].nextSyncAt).toEqual(new Date("2026-11-10T12:00:00Z"));
  });
});
