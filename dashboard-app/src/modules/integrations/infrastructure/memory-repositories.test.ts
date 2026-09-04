import { describe, expect, it } from "vitest";
import {
  MemoryConnectionsRepository,
  MemorySyncJobsRepository,
  MemorySyncRunsRepository,
  memoryCipher,
} from "./memory-repositories";

const USER = "11111111-1111-7111-8111-111111111111";
const OTHER = "22222222-2222-7222-8222-222222222222";

describe("memory connections repository", () => {
  it("creates, finds by provider, hides another user's row and enforces the version", async () => {
    const repo = new MemoryConnectionsRepository();
    const created = await repo.create({
      userId: USER,
      provider: "wallet",
      status: "disconnected",
      settings: {},
      disconnectPolicy: "keep",
    });
    expect(created.version).toBe(1);
    expect((await repo.getByProvider(USER, "wallet"))?.id).toBe(created.id);
    expect(await repo.getByProvider(OTHER, "wallet")).toBeNull();
    expect(await repo.get(OTHER, created.id)).toBeNull();
    // `getById` is the system paths' lookup: no user id, because the webhook
    // and the queue drain do not have one.
    expect((await repo.getById(created.id))?.userId).toBe(USER);

    const updated = await repo.update(USER, created.id, 1, { disconnectPolicy: "archive" });
    // Narrowed, not cast: the three-way return IS the contract, and a cast
    // would keep passing if `update` started answering something else.
    if (updated === null || updated === "version_mismatch") {
      throw new Error(`expected the updated connection, got ${String(updated)}`);
    }
    expect(updated.version).toBe(2);
    expect(updated.disconnectPolicy).toBe("archive");
    expect(await repo.update(USER, created.id, 1, { disconnectPolicy: "purge" })).toBe("version_mismatch");
  });

  it("round-trips credentials and clears them on null", async () => {
    const repo = new MemoryConnectionsRepository();
    const cipher = memoryCipher();
    const c = await repo.create({
      userId: USER,
      provider: "wallet",
      status: "disconnected",
      settings: {},
      disconnectPolicy: "keep",
    });
    await repo.writeCredentials(USER, c.id, cipher.seal({ token: "t" }));
    const sealed = await repo.readCredentials(USER, c.id);
    expect(sealed).not.toBeNull();
    expect(cipher.open(sealed!)).toEqual({ token: "t" });
    await repo.writeCredentials(USER, c.id, null);
    expect(await repo.readCredentials(USER, c.id)).toBeNull();
  });
});

describe("memory sync runs repository", () => {
  it("reports a running run and stops reporting it once finished", async () => {
    const runs = new MemorySyncRunsRepository();
    const started = await runs.start({
      connectionId: "c1",
      jobId: null,
      kind: "accounts",
      trigger: "manual",
      startedAt: new Date("2026-09-04T08:00:00Z"),
    });
    expect((await runs.running("c1", "accounts"))?.id).toBe(started.id);
    await runs.finish(started.id, {
      status: "success",
      stats: { created: 2 },
      error: null,
      finishedAt: new Date("2026-09-04T08:00:05Z"),
    });
    expect(await runs.running("c1", "accounts")).toBeNull();
    expect((await runs.recent("c1", 10))[0]?.stats).toEqual({ created: 2 });
  });

  it("queues a run, hands it out once, and never twice", async () => {
    const runs = new MemorySyncRunsRepository();
    const queued = await runs.enqueue({
      connectionId: "c1",
      jobId: null,
      kind: "accounts",
      trigger: "webhook",
      queuedAt: new Date("2026-09-04T08:00:00Z"),
    });
    expect(queued.status).toBe("queued");
    // A queued run is not a running one: it must not make the next trigger join it.
    expect(await runs.running("c1", "accounts")).toBeNull();
    expect((await runs.queued(10)).map((r) => r.id)).toEqual([queued.id]);

    const claimed = await runs.claim(queued.id, new Date("2026-09-04T08:01:00Z"));
    expect(claimed?.status).toBe("running");
    expect(await runs.queued(10)).toEqual([]);
    // A second tick that raced the first gets nothing rather than a double run.
    expect(await runs.claim(queued.id, new Date("2026-09-04T08:01:01Z"))).toBeNull();
  });
});

describe("memory sync jobs repository", () => {
  it("creates a job once per (connection, kind) and remembers its cursor", async () => {
    const jobs = new MemorySyncJobsRepository();
    const first = await jobs.ensure({ connectionId: "c1", kind: "accounts", schedule: "daily" });
    const again = await jobs.ensure({ connectionId: "c1", kind: "accounts", schedule: "daily" });
    expect(again.id).toBe(first.id);
    expect(await jobs.listForConnection("c1")).toHaveLength(1);
    expect(first.enabled).toBe(true);
    expect(first.cursor).toBeNull();

    await jobs.setCursor(first.id, { page: 2 });
    expect((await jobs.find("c1", "accounts"))?.cursor).toEqual({ page: 2 });
    expect(await jobs.find("c1", "leave")).toBeNull();
  });
});
