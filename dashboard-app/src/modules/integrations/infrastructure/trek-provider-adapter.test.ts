import { describe, expect, it, vi } from "vitest";
import { runTrekSync } from "@/modules/timeoff/infrastructure/trek-sync";
import { unusedDb } from "@/test/integration-deps";
import type { IntegrationConnection } from "@/platform/integrations/types";
import { trekProvider } from "./trek-provider-adapter";

vi.mock("@/lib/clients/trek", () => ({
  getEntries: vi.fn(async (_year: number, opts: { config: { token: string } }) => {
    if (opts.config.token !== "trek_good") throw new Error("MCP rejected the token");
    return [{ id: 1, date: "2026-09-04", note: "", fraction: 1, kind: "vacation" }];
  }),
}));

vi.mock("@/modules/timeoff/infrastructure/trek-store", () => ({
  drizzleTimeoffStore: vi.fn(() => ({ withEvents: async () => { throw new Error("unused"); } })),
}));

vi.mock("@/modules/timeoff/infrastructure/trek-sync", () => ({
  runTrekSync: vi.fn(async () => ({
    status: "ok",
    year: 2026,
    pulled: 3,
    deleted: 0,
    pushed: 1,
    weekendBlocked: [],
    stillPending: [],
    stats: null,
    errors: [],
  })),
}));

function connectionFixture(): IntegrationConnection {
  return {
    id: "c1",
    userId: "u1",
    provider: "trek",
    status: "connected",
    settings: {},
    lastTestAt: null,
    lastSyncAt: null,
    lastError: null,
    disconnectPolicy: "keep",
    version: 1,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

describe("trek provider adapter", () => {
  it("declares its code, capability and both credential fields", () => {
    expect(trekProvider.code).toBe("trek");
    expect([...trekProvider.capabilities]).toEqual(["leave"]);
    expect(trekProvider.credentialFields.map((f) => f.name)).toEqual(["baseUrl", "token", "webhookSecret"]);
  });

  it("requires a URL and a token", () => {
    expect(trekProvider.credentialSchema.safeParse({ token: "trek_good" }).success).toBe(false);
    expect(
      trekProvider.credentialSchema.safeParse({ baseUrl: "https://trek.example", token: "trek_good" }).success,
    ).toBe(true);
    expect(
      trekProvider.credentialSchema.safeParse({ baseUrl: "not a url", token: "trek_good" }).success,
    ).toBe(false);
  });

  it("tests with a pure read and reports failure without leaking the token", async () => {
    const ok = await trekProvider.testConnection(
      { baseUrl: "https://trek.example", token: "trek_good" },
      {},
    );
    expect(ok.ok).toBe(true);
    const bad = await trekProvider.testConnection(
      { baseUrl: "https://trek.example", token: "trek_bad" },
      {},
    );
    expect(bad.ok).toBe(false);
    expect(bad.message).not.toContain("trek_bad");
  });

  it("runs a leave sync in the fetch phase and reports the pass counts as stats", async () => {
    // Trek's sync owns its own advisory lock and its own database connection
    // (see `trek-sync.ts`), so ALL of it belongs to `fetch`; `apply` only reads
    // the counts off the result and never touches `ctx.db`.
    const leave = trekProvider.syncs.leave!;
    expect(leave.schedule).toBe("hourly");
    const pass = await leave.fetch({
      connection: connectionFixture(),
      credentials: { baseUrl: "https://trek.example", token: "trek_good" },
      runId: "r1",
      clock: { now: () => new Date("2026-09-04T09:00:00Z") },
      cursor: null,
    });
    const stats = await leave.apply(
      {
        connection: connectionFixture(),
        runId: "r1",
        db: unusedDb,
        clock: { now: () => new Date("2026-09-04T09:00:00Z") },
        cursor: null,
        setCursor: () => {
          throw new Error("the leave sync has no cursor to set");
        },
        audit: async () => {},
      },
      pass,
    );
    expect(stats).toEqual({ pulled: 3, deleted: 0, pushed: 1 });
    // The pass is scoped to the CONNECTION's owner and given a store of its
    // own: an hourly run has no principal, and `fetch` has nothing open, so
    // the sync must be the thing that opens each short database context.
    expect(vi.mocked(runTrekSync).mock.calls[0]?.[0]).toMatchObject({ userId: "u1" });
    expect(vi.mocked(runTrekSync).mock.calls[0]?.[0].store).toBeDefined();
  });

  it("fails the run when the pass was partial, so the last-sync stamp cannot stay green", async () => {
    const leave = trekProvider.syncs.leave!;
    const partial = {
      status: "partial" as const,
      year: 2026,
      pulled: 1,
      deleted: 0,
      pushed: 0,
      weekendBlocked: [],
      stillPending: ["2026-09-10"],
      stats: null,
      errors: ["Trek refused 2026-09-10"],
    };
    await expect(
      leave.apply(
        {
          connection: connectionFixture(),
          runId: "r1",
          db: unusedDb,
          clock: { now: () => new Date("2026-09-04T09:00:00Z") },
          cursor: null,
          setCursor: () => {},
          audit: async () => {},
        },
        partial,
      ),
    ).rejects.toThrow(/Trek refused 2026-09-10/);
  });

  it("leaves the owner's timeoff events alone on every disconnect policy", async () => {
    const audits: string[] = [];
    await trekProvider.onDisconnect({
      connection: { ...connectionFixture(), disconnectPolicy: "purge" },
      policy: "purge",
      db: unusedDb,
      clock: { now: () => new Date("2026-09-04T09:00:00Z") },
      audit: async (e) => {
        audits.push(e.action);
      },
    });
    expect(audits).toEqual(["integration.disconnect_applied"]);
  });
});
