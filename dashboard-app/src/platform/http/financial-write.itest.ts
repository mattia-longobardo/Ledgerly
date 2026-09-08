import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { idempotencyKeys } from "@/lib/db/schema";
import { withUserContext } from "@/platform/db/context";
import { closeDb, resetDb, testDb } from "@/test/db";
import { runFinancialWrite } from "./financial-write";

/**
 * Exercises `runFinancialWrite` directly — the shared platform helper both
 * `funds` and `budgets` now sit on top of — rather than through either
 * module's routes, so the property holds independently of any one module's
 * DTOs or use cases.
 */
describe("runFinancialWrite", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  const now = () => new Date("2026-09-06T10:00:00.000Z");
  const request = (key: string, body = "{}") => ({ key, method: "POST", path: "/x", body });

  /**
   * A gate the test controls: `write` signals `started` the moment it runs
   * (proving it got past the advisory lock and the cache check), then blocks
   * on `gate` until the test releases it. This plays the same role funds'
   * `overlappingRequests` gives an externally-held row lock on a fund — a
   * way to guarantee two calls are genuinely in flight at once — but
   * without depending on any module's table.
   */
  function gatedWrite<T>(result: T) {
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    const write = async () => {
      calls += 1;
      started();
      await gate;
      return result;
    };
    return { write, release, started: startedPromise, callCount: () => calls };
  }

  /** Polls until `atLeast` other backends are blocked waiting on a lock, or fails. */
  async function waitForLockWaiters(db: Awaited<ReturnType<typeof testDb>>, atLeast: number): Promise<void> {
    const deadline = Date.now() + 5_000;
    let waiting = 0;
    while (Date.now() < deadline) {
      const result = await db.execute<{ waiting: number }>(sql`
        SELECT count(*)::integer AS waiting FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid()
          AND wait_event_type = 'Lock'`);
      waiting = result.rows[0]!.waiting;
      if (waiting >= atLeast) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(waiting).toBeGreaterThanOrEqual(atLeast);
  }

  it("serializes two overlapping calls sharing (namespace, principalId, key): write runs once, the second replays the first's result", async () => {
    const db = await testDb();
    const principalId = randomUUID();
    const first = gatedWrite({ echoed: "first" });

    const firstPromise = runFinancialWrite({ db, now }, "test-ns", principalId, request("shared-key"), first.write);
    await first.started;

    // The second call must reach `pg_advisory_xact_lock` and block there —
    // the first call's transaction is still open (paused inside `write`), so
    // this can only be true if the two calls actually contend for the same
    // lock, not merely run one after the other by scheduling luck.
    const secondCalls = { n: 0 };
    const second = async () => { secondCalls.n += 1; return { echoed: "second" }; };
    const secondPromise = runFinancialWrite({ db, now }, "test-ns", principalId, request("shared-key"), second);
    await waitForLockWaiters(db, 1);

    first.release();
    const [firstResult, secondResult] = await Promise.all([firstPromise, secondPromise]);

    expect(first.callCount()).toBe(1);
    expect(secondCalls.n).toBe(0);
    expect(firstResult).toEqual({ body: { echoed: "first" }, status: 201 });
    expect(secondResult).toEqual(firstResult);
  });

  it("does not serialize or collide across namespaces sharing the same principalId and key", async () => {
    const db = await testDb();
    const principalId = randomUUID();
    const a = gatedWrite({ echoed: "a" });
    const b = gatedWrite({ echoed: "b" });

    const aPromise = runFinancialWrite({ db, now }, "namespace-a", principalId, request("same-key"), a.write);
    await a.started;

    // If the lock id (or the cache row) were shared across namespaces, `b`
    // would either block behind `a`'s still-open transaction or replay `a`'s
    // eventual result instead of running its own `write` — so a bounded wait
    // for `b.started` is itself the isolation proof: it must resolve while
    // `a` is deliberately still held open.
    const bPromise = runFinancialWrite({ db, now }, "namespace-b", principalId, request("same-key"), b.write);
    const bStartedInTime = await Promise.race([
      b.started.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2_000)),
    ]);
    expect(bStartedInTime).toBe(true);

    a.release();
    b.release();
    const [aResult, bResult] = await Promise.all([aPromise, bPromise]);

    expect(a.callCount()).toBe(1);
    expect(b.callCount()).toBe(1);
    expect(aResult).toEqual({ body: { echoed: "a" }, status: 201 });
    expect(bResult).toEqual({ body: { echoed: "b" }, status: 201 });
  });

  it("does not persist an idempotency row when the write body throws — a retry re-executes rather than replaying the failure", async () => {
    const db = await testDb();
    const principalId = randomUUID();
    let calls = 0;
    const failingWrite = async () => {
      calls += 1;
      throw new Error("boom");
    };

    await expect(runFinancialWrite({ db, now }, "test-ns", principalId, request("retry-key"), failingWrite)).rejects.toThrow("boom");
    expect(calls).toBe(1);

    const rows = await withUserContext(db, { userId: principalId }, (tx) =>
      // The persisted row is keyed internally as `${namespace}:${key}` — see
      // `runFinancialWrite`'s comment — never the raw `Idempotency-Key` value.
      tx.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.principalId, principalId), eq(idempotencyKeys.key, "test-ns:retry-key"))),
    );
    expect(rows).toHaveLength(0);

    const succeedingWrite = async () => {
      calls += 1;
      return { ok: true };
    };
    const result = await runFinancialWrite({ db, now }, "test-ns", principalId, request("retry-key"), succeedingWrite);
    expect(calls).toBe(2);
    expect(result).toEqual({ body: { ok: true }, status: 201 });

    const rowsAfter = await withUserContext(db, { userId: principalId }, (tx) =>
      // The persisted row is keyed internally as `${namespace}:${key}` — see
      // `runFinancialWrite`'s comment — never the raw `Idempotency-Key` value.
      tx.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.principalId, principalId), eq(idempotencyKeys.key, "test-ns:retry-key"))),
    );
    expect(rowsAfter).toHaveLength(1);
  });

  /**
   * The persisted cache row is keyed only by `(principalId, key)` — the
   * `idempotencyKeys` table has no namespace column, and round 2's
   * serialization proof only covers the advisory *lock*, which does carry
   * the namespace. Two different namespaces sharing a principalId and the
   * same literal `Idempotency-Key` value must not share that row: each
   * namespace's own commit must be findable (and replayable) only by a
   * later call in that same namespace, never by the other one.
   */
  it("scopes the persisted cache row by namespace — two namespaces sharing principalId and key each replay their own body, not the other's", async () => {
    const db = await testDb();
    const principalId = randomUUID();
    let aCalls = 0;
    let bCalls = 0;
    const writeA = async () => { aCalls += 1; return { echoed: "a" }; };
    const writeB = async () => { bCalls += 1; return { echoed: "b" }; };
    const requestA = request("shared-key", JSON.stringify({ tag: "a" }));
    const requestB = request("shared-key", JSON.stringify({ tag: "b" }));

    const firstA = await runFinancialWrite({ db, now }, "namespace-a", principalId, requestA, writeA);
    // Without namespace scoping on the row, this sees namespace-a's row
    // under the same (principalId, key) with a different request hash (a
    // different body) and throws `idempotency_key_reused` — a false
    // positive, since namespace-b never touched this key before.
    const firstB = await runFinancialWrite({ db, now }, "namespace-b", principalId, requestB, writeB);

    expect(aCalls).toBe(1);
    expect(bCalls).toBe(1);
    expect(firstA).toEqual({ body: { echoed: "a" }, status: 201 });
    expect(firstB).toEqual({ body: { echoed: "b" }, status: 201 });

    const replayA = await runFinancialWrite({ db, now }, "namespace-a", principalId, requestA, writeA);
    const replayB = await runFinancialWrite({ db, now }, "namespace-b", principalId, requestB, writeB);

    expect(aCalls).toBe(1);
    expect(bCalls).toBe(1);
    expect(replayA).toEqual(firstA);
    expect(replayB).toEqual(firstB);
  });

  /**
   * The deploy-boundary shim in `runFinancialWrite`. `funds` was live before
   * the `<namespace>:` prefix existed, so its rows in `idempotency_keys` carry
   * the bare key. A client retrying a contribution across the deploy must
   * replay that row, not re-execute the write and create a second
   * contribution. DELETE THIS CASE with the shim, 24h after the cutover.
   */
  it("replays a pre-cutover funds row stored under the bare key instead of re-executing the write", async () => {
    const db = await testDb();
    const principalId = randomUUID();
    const legacy = request("legacy-key");
    // Exactly what the former `idempotency()` middleware persisted: bare key,
    // and the same `${method} ${path}\n${body}` hash this helper computes.
    const requestHash = createHash("sha256").update(`${legacy.method} ${legacy.path}\n${legacy.body}`).digest("hex");
    await withUserContext(db, { userId: principalId }, (tx) =>
      tx.insert(idempotencyKeys).values({
        principalId,
        key: "legacy-key",
        requestHash,
        statusCode: 201,
        responseBody: { echoed: "pre-cutover" },
        expiresAt: new Date(now().getTime() + 60_000),
      }),
    );

    let calls = 0;
    const write = async () => { calls += 1; return { echoed: "re-executed" }; };
    const result = await runFinancialWrite({ db, now }, "funds", principalId, legacy, write);

    expect(calls).toBe(0);
    expect(result).toEqual({ body: { echoed: "pre-cutover" }, status: 201 });

    // The shim is scoped to `funds` alone: no other namespace inherits a bare
    // key it never wrote, so this stays a one-module, one-deploy exception.
    let otherCalls = 0;
    const otherWrite = async () => { otherCalls += 1; return { echoed: "budgets" }; };
    const otherResult = await runFinancialWrite({ db, now }, "budgets", principalId, legacy, otherWrite);
    expect(otherCalls).toBe(1);
    expect(otherResult).toEqual({ body: { echoed: "budgets" }, status: 201 });
  });

  /**
   * Migrated from the deleted `idempotency.itest.ts` (the superseded,
   * non-atomic middleware): a stored row is only a valid replay target while
   * `expiresAt > now()`. Once the TTL lapses, the same key must start a
   * fresh window — re-executing the write, replaying that new result on a
   * subsequent identical call, and still rejecting a reused key against a
   * different body within that new window.
   */
  it("starts a fresh 24h window after a key's stored response has expired", async () => {
    const db = await testDb();
    const principalId = randomUUID();
    let time = new Date("2026-09-02T10:00:00.000Z");
    const clock = () => time;
    let calls = 0;
    const write = async () => { calls += 1; return { n: calls }; };

    const first = await runFinancialWrite({ db, now: clock }, "test-ns", principalId, request("expiring-key", JSON.stringify({ v: 1 })), write);
    expect(first).toEqual({ body: { n: 1 }, status: 201 });
    expect(calls).toBe(1);

    time = new Date(time.getTime() + 25 * 60 * 60 * 1000);

    const reqV2 = request("expiring-key", JSON.stringify({ v: 2 }));
    const afterExpiry = await runFinancialWrite({ db, now: clock }, "test-ns", principalId, reqV2, write);
    expect(afterExpiry).toEqual({ body: { n: 2 }, status: 201 });
    expect(calls).toBe(2);

    const replay = await runFinancialWrite({ db, now: clock }, "test-ns", principalId, reqV2, write);
    expect(replay).toEqual({ body: { n: 2 }, status: 201 });
    expect(calls).toBe(2);

    const differentBody = request("expiring-key", JSON.stringify({ v: 3 }));
    await expect(
      runFinancialWrite({ db, now: clock }, "test-ns", principalId, differentBody, write),
    ).rejects.toThrow("Idempotency-Key was already used with a different request");
    expect(calls).toBe(2);
  });
});
