import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { testPrincipal } from "@/test/principal";
import { PermissionDeniedError } from "@/platform/auth/principal";
import { testIntegrationDeps } from "@/test/integration-deps";
import type {
  IntegrationProvider,
  ProviderRegistry,
  SyncApplyContext,
  SyncFetchContext,
} from "@/platform/integrations/types";
import type { IntegrationDeps } from "./deps";
import { connectIntegration } from "./connect-integration";
import { drainSyncQueue } from "./drain-sync-queue";
import { enqueueSync } from "./enqueue-sync";
import { runSync } from "./run-sync";
import { ConnectionNotUsableError, SyncDisabledError, SyncNotSupportedError } from "./errors";

const principal = testPrincipal();
let fetched: SyncFetchContext[] = [];
let applied: SyncApplyContext[] = [];
let fetchImpl: (ctx: SyncFetchContext) => Promise<unknown>;
let applyImpl: (ctx: SyncApplyContext, payload: unknown) => Promise<Record<string, number>>;

function provider(): IntegrationProvider {
  return {
    code: "wallet",
    label: "Budget Makers Wallet",
    capabilities: ["accounts"],
    credentialSchema: z.object({ token: z.string().min(1) }),
    credentialFields: [{ name: "token", label: "API token", secret: true }],
    testConnection: async () => ({ ok: true, message: "ok" }),
    syncs: {
      accounts: {
        schedule: "daily",
        fetch: (ctx) => {
          fetched.push(ctx);
          return fetchImpl(ctx);
        },
        apply: (ctx, payload) => {
          applied.push(ctx);
          return applyImpl(ctx, payload);
        },
      },
    },
    onDisconnect: async () => {},
  };
}

function makeDeps(): IntegrationDeps {
  const registry: ProviderRegistry = {
    get: (code) => (code === "wallet" ? provider() : null),
    list: () => [provider()],
  };
  return testIntegrationDeps({ registry });
}

async function connected(deps: IntegrationDeps) {
  const { connection } = await connectIntegration(deps)(principal, {
    provider: "wallet",
    credentials: { token: "t" },
  });
  return connection;
}

describe("runSync", () => {
  beforeEach(() => {
    fetched = [];
    applied = [];
    fetchImpl = async () => ["row-a", "row-b"];
    applyImpl = async () => ({ created: 2, updated: 1 });
  });

  it("fetches with the credential, applies with the database, and records the stats", async () => {
    const deps = makeDeps();
    const connection = await connected(deps);
    const run = await runSync(deps)(principal, { provider: "wallet", kind: "accounts", trigger: "manual" });

    expect(run.status).toBe("success");
    expect(run.stats).toEqual({ created: 2, updated: 1 });
    expect(run.finishedAt).toEqual(new Date("2026-09-04T09:00:00Z"));
    expect(run.jobId).toBe((await deps.jobs.find(connection.id, "accounts"))!.id);

    // The credential reaches `fetch` and only `fetch`; `apply` has no field for it.
    expect(fetched[0]!.credentials).toEqual({ token: "t" });
    expect(fetched[0]!.connection.id).toBe(connection.id);
    expect(fetched[0]!.runId).toBe(run.id);
    expect(applied[0]!.runId).toBe(run.id);
    expect(Object.keys(applied[0]!)).not.toContain("credentials");

    const fresh = await deps.connections.getByProvider(principal.userId, "wallet");
    expect(fresh?.lastSyncAt).toEqual(new Date("2026-09-04T09:00:00Z"));
    expect(fresh?.status).toBe("connected");
  });

  it("hands `apply` exactly what `fetch` returned", async () => {
    const deps = makeDeps();
    await connected(deps);
    let seenPayload: unknown = null;
    fetchImpl = async () => ({ page: 1, rows: ["x"] });
    applyImpl = async (_ctx, payload) => {
      seenPayload = payload;
      return { created: 1 };
    };
    await runSync(deps)(principal, { provider: "wallet", kind: "accounts", trigger: "manual" });
    expect(seenPayload).toEqual({ page: 1, rows: ["x"] });
  });

  it("records a thrown fetch as a failed run and moves the connection to error", async () => {
    const deps = makeDeps();
    await connected(deps);
    fetchImpl = async () => {
      throw new Error("provider said no");
    };
    const run = await runSync(deps)(principal, { provider: "wallet", kind: "accounts", trigger: "cron" });
    expect(run.status).toBe("failed");
    expect(run.error).toBe("provider said no");
    expect(applied).toHaveLength(0);
    expect((await deps.connections.getByProvider(principal.userId, "wallet"))?.status).toBe("error");
  });

  it("persists a cursor on success and leaves it alone on failure", async () => {
    const deps = makeDeps();
    const connection = await connected(deps);
    const job = await deps.jobs.find(connection.id, "accounts");

    applyImpl = async (ctx) => {
      expect(ctx.cursor).toBeNull();
      ctx.setCursor({ since: "2026-09-04" });
      return { created: 1 };
    };
    await runSync(deps)(principal, { provider: "wallet", kind: "accounts", trigger: "manual" });
    expect((await deps.jobs.find(connection.id, "accounts"))?.cursor).toEqual({ since: "2026-09-04" });

    // The next pass sees it…
    let saw: unknown = "not called";
    applyImpl = async (ctx) => {
      saw = ctx.cursor;
      ctx.setCursor({ since: "2026-09-05" });
      throw new Error("upstream fell over");
    };
    const failed = await runSync(deps)(principal, { provider: "wallet", kind: "accounts", trigger: "manual" });
    expect(saw).toEqual({ since: "2026-09-04" });
    expect(failed.status).toBe("failed");
    // …and a failed pass must not advance it past rows it never imported.
    expect((await deps.jobs.find(connection.id, "accounts"))?.cursor).toEqual({ since: "2026-09-04" });
    expect(job!.id).toBe((await deps.jobs.find(connection.id, "accounts"))!.id);
  });

  it("returns the running run instead of starting a second one", async () => {
    const deps = makeDeps();
    const connection = await connected(deps);
    const inFlight = await deps.runs.start({
      connectionId: connection.id,
      jobId: null,
      kind: "accounts",
      trigger: "cron",
      startedAt: new Date("2026-09-04T08:59:00Z"),
    });
    const run = await runSync(deps)(principal, { provider: "wallet", kind: "accounts", trigger: "manual" });
    expect(run.id).toBe(inFlight.id);
    expect(run.status).toBe("running");
    expect(fetched).toHaveLength(0);
  });

  it("defaults the kind to the provider's only sync", async () => {
    const deps = makeDeps();
    await connected(deps);
    const run = await runSync(deps)(principal, { provider: "wallet", trigger: "manual" });
    expect(run.kind).toBe("accounts");
    expect(run.status).toBe("success");
  });

  it("refuses a kind the provider does not implement, a disabled job and a connection that is not connected", async () => {
    const deps = makeDeps();
    const connection = await connected(deps);
    await expect(
      runSync(deps)(principal, { provider: "wallet", kind: "leave", trigger: "manual" }),
    ).rejects.toBeInstanceOf(SyncNotSupportedError);

    const job = await deps.jobs.find(connection.id, "accounts");
    Object.assign(deps.jobs, { find: async () => ({ ...job!, enabled: false }) });
    await expect(
      runSync(deps)(principal, { provider: "wallet", kind: "accounts", trigger: "manual" }),
    ).rejects.toBeInstanceOf(SyncDisabledError);
    Object.assign(deps.jobs, { find: async () => job });

    await deps.connections.recordState(connection.id, { status: "disabled" });
    await expect(
      runSync(deps)(principal, { provider: "wallet", kind: "accounts", trigger: "manual" }),
    ).rejects.toBeInstanceOf(ConnectionNotUsableError);
  });

  it("refuses a principal without integrations.manage", async () => {
    const deps = makeDeps();
    await connected(deps);
    await expect(
      runSync(deps)(testPrincipal({ roles: ["viewer"] }), {
        provider: "wallet",
        kind: "accounts",
        trigger: "manual",
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe("the sync queue", () => {
  beforeEach(() => {
    fetched = [];
    applied = [];
    fetchImpl = async () => ["row-a"];
    applyImpl = async () => ({ created: 1 });
  });

  it("enqueues without doing the work, then drains it in the owner's context", async () => {
    const deps = makeDeps();
    const connection = await connected(deps);

    const queued = await enqueueSync(deps)(connection, "accounts", "webhook");
    expect(queued.status).toBe("queued");
    expect(queued.trigger).toBe("webhook");
    expect(queued.jobId).toBe((await deps.jobs.find(connection.id, "accounts"))!.id);
    // Nothing ran: that is the whole point of spec §3.4.
    expect(fetched).toHaveLength(0);

    const drained = await drainSyncQueue(deps)(10);
    expect(drained.map((r) => r.id)).toEqual([queued.id]);
    expect(drained[0]!.status).toBe("success");
    expect(fetched).toHaveLength(1);
    // The same row, executed — not a second one.
    expect(await deps.runs.queued(10)).toEqual([]);
    expect((await deps.runs.recent(connection.id, 10)).filter((r) => r.trigger === "webhook")).toHaveLength(1);
  });

  it("refuses to enqueue a disabled kind", async () => {
    const deps = makeDeps();
    const connection = await connected(deps);
    const job = await deps.jobs.find(connection.id, "accounts");
    Object.assign(deps.jobs, { find: async () => ({ ...job!, enabled: false }) });
    await expect(enqueueSync(deps)(connection, "accounts", "webhook")).rejects.toBeInstanceOf(
      SyncDisabledError,
    );
  });

  it("drops a queued run whose connection has gone, without failing the tick", async () => {
    const deps = makeDeps();
    const connection = await connected(deps);
    await enqueueSync(deps)(connection, "accounts", "webhook");
    await deps.connections.delete(principal.userId, connection.id);
    // The run row outlives the connection only in memory; in Postgres the
    // cascade removes it. Either way the tick reports nothing and moves on.
    await expect(drainSyncQueue(deps)(10)).resolves.toEqual([]);
  });
});
