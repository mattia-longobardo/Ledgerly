import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { testPrincipal } from "@/test/principal";
import { PermissionDeniedError } from "@/platform/auth/principal";
import { testIntegrationDeps } from "@/test/integration-deps";
import { MemorySyncJobsRepository } from "../infrastructure/memory-repositories";
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

  it("redacts the credential from a failed run's error before it is persisted or audited", async () => {
    const deps = makeDeps();
    const auditCalls: Record<string, unknown>[] = [];
    Object.assign(deps, {
      audit: async (e: Record<string, unknown>) => {
        auditCalls.push(e);
      },
    });
    const secret = "sk-live-91mN7fQ2xyz";
    await connectIntegration(deps)(principal, { provider: "wallet", credentials: { token: secret } });
    fetchImpl = async () => {
      throw new Error(`upstream rejected token ${secret}`);
    };

    const run = await runSync(deps)(principal, { provider: "wallet", kind: "accounts", trigger: "manual" });
    expect(run.status).toBe("failed");
    expect(run.error).not.toContain(secret);
    expect(run.error).toContain("[redacted]");

    const failureAudit = auditCalls.find((a) => a.action === "integration.sync_failed");
    expect(failureAudit).toBeDefined();
    expect(JSON.stringify(failureAudit)).not.toContain(secret);
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

  it("ensures the job row for a kind that has none, and persists its cursor on the very first run", async () => {
    const deps = makeDeps();
    const connection = await connected(deps);
    // A connection whose `sync_jobs` row for this kind is missing entirely —
    // the shape of one made before the provider declared this `SyncKind`, or
    // reached by a manual trigger naming a kind nothing has synced yet (the
    // carried gap Task 12 closed: `prepare()` used to `find()` this row and
    // silently drop the cursor write when it came back `undefined`).
    Object.assign(deps, { jobs: new MemorySyncJobsRepository() });
    expect(await deps.jobs.find(connection.id, "accounts")).toBeNull();

    applyImpl = async (ctx) => {
      expect(ctx.cursor).toBeNull();
      ctx.setCursor({ since: "2026-09-04" });
      return { created: 1 };
    };
    const run = await runSync(deps)(principal, { provider: "wallet", kind: "accounts", trigger: "manual" });
    expect(run.status).toBe("success");

    const job = await deps.jobs.find(connection.id, "accounts");
    expect(job).not.toBeNull();
    expect(job!.cursor).toEqual({ since: "2026-09-04" });
    expect(run.jobId).toBe(job!.id);
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

    // `prepare()` now `ensure()`s the job row rather than merely `find()`ing
    // it — this stubs `ensure` (not `find`) to simulate the same "disabled"
    // state a real reconnect-preserving row would have.
    const job = await deps.jobs.find(connection.id, "accounts");
    Object.assign(deps.jobs, { ensure: async () => ({ ...job!, enabled: false }) });
    await expect(
      runSync(deps)(principal, { provider: "wallet", kind: "accounts", trigger: "manual" }),
    ).rejects.toBeInstanceOf(SyncDisabledError);
    Object.assign(deps.jobs, { ensure: async () => job! });

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

  it("finishes a row that fails before execution as failed, and still drains the rest of the batch", async () => {
    const deps = makeDeps();
    const principalB = testPrincipal({ userId: "00000000-0000-7000-8000-000000000002" });
    const connectionA = await connected(deps);
    const { connection: connectionB } = await connectIntegration(deps)(principalB, {
      provider: "wallet",
      credentials: { token: "t" },
    });

    const queuedA = await enqueueSync(deps)(connectionA, "accounts", "webhook");
    const queuedB = await enqueueSync(deps)(connectionB, "accounts", "webhook");

    // A's job is disabled after it was queued but before the tick — the same
    // shape as somebody switching a kind off from Settings in between. This
    // must not be confused with the FK-cascade case: the connection and job
    // both still exist, only `enabled` changed, so `prepare()` throws
    // `SyncDisabledError` synchronously, before `execute()`'s own try/catch
    // exists to catch it. Stubs `ensure` (not `find`) — `prepare()` now
    // resolves the job row through `ensure()`.
    const jobA = await deps.jobs.find(connectionA.id, "accounts");
    const originalEnsure = deps.jobs.ensure.bind(deps.jobs);
    Object.assign(deps.jobs, {
      ensure: async (input: Parameters<typeof originalEnsure>[0]) =>
        input.connectionId === connectionA.id ? { ...jobA!, enabled: false } : originalEnsure(input),
    });

    const drained = await drainSyncQueue(deps)(10);

    // B ran despite A blowing up first in the same batch — that is the whole
    // point: one bad row must not stall the rest of the tick.
    expect(fetched).toHaveLength(1);
    const resultA = drained.find((r) => r.id === queuedA.id);
    const resultB = drained.find((r) => r.id === queuedB.id);
    expect(resultA?.status).toBe("failed");
    expect(resultA?.error).toMatch(/switched off/);
    expect(resultB?.status).toBe("success");

    // The failed row is finished, not left `queued` — an oldest-first queue
    // that never resolves it would pick it first again on every future tick.
    expect(await deps.runs.queued(10)).toEqual([]);
    expect((await deps.runs.recent(connectionA.id, 10))[0]!.status).toBe("failed");
  });

  it("still drains the rest of the batch when the failure bookkeeping write itself throws", async () => {
    const deps = makeDeps();
    const principalB = testPrincipal({ userId: "00000000-0000-7000-8000-000000000003" });
    const connectionA = await connected(deps);
    const { connection: connectionB } = await connectIntegration(deps)(principalB, {
      provider: "wallet",
      credentials: { token: "t" },
    });

    const queuedA = await enqueueSync(deps)(connectionA, "accounts", "webhook");
    await enqueueSync(deps)(connectionB, "accounts", "webhook");

    // Same setup as the test above: A fails before execution even starts.
    const jobA = await deps.jobs.find(connectionA.id, "accounts");
    const originalEnsure = deps.jobs.ensure.bind(deps.jobs);
    Object.assign(deps.jobs, {
      ensure: async (input: Parameters<typeof originalEnsure>[0]) =>
        input.connectionId === connectionA.id ? { ...jobA!, enabled: false } : originalEnsure(input),
    });

    // And now the bookkeeping write the catch block uses to record that
    // failure ALSO throws — the same failure mode the guard exists to
    // prevent, one layer deeper. This must not escape the loop and take out
    // every row after it, including connection B's.
    const originalFinish = deps.runs.finish.bind(deps.runs);
    Object.assign(deps.runs, {
      finish: async (id: string, patch: Parameters<typeof originalFinish>[1]) =>
        id === queuedA.id ? Promise.reject(new Error("db write failed")) : originalFinish(id, patch),
    });

    const drained = await drainSyncQueue(deps)(10);

    // B still ran and is reported, despite A's bookkeeping write blowing up.
    expect(fetched).toHaveLength(1);
    expect(drained.some((r) => r.status === "success")).toBe(true);
    expect(drained.find((r) => r.id === queuedA.id)).toBeUndefined();

    // A's row could not be marked failed — its bookkeeping write is exactly
    // what threw — so it is left `queued` rather than lost silently; the next
    // tick will pick it up and retry.
    expect((await deps.runs.queued(10)).map((r) => r.id)).toEqual([queuedA.id]);
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
