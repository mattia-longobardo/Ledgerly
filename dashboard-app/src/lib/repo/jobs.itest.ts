/**
 * `withJobLock` against real Postgres (R9-1).
 *
 * The point of these tests is what the previous implementation could not do:
 * hold the lock on a *session* rather than a transaction, so the job body runs
 * with no transaction open on the locked connection and may therefore open its
 * own (`withUserContext`) or spend minutes in network I/O without a
 * long-running transaction hanging off the pool.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { withJobLock } from "@/lib/repo/jobs";
import { withUserContext } from "@/platform/db/context";
import { closeDb, testDb } from "@/test/db";

/** A promise the test resolves by hand, so a job body can be held open. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/**
 * A connection of its own: `pg_advisory_unlock` only works on the session that
 * took the lock, and a pool hands out a different connection per query.
 */
async function withOwnSession<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function tryLockFromAnotherSession(key: string): Promise<boolean> {
  return withOwnSession(async (client) => {
    const res = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
      [key],
    );
    const locked = res.rows[0]?.locked === true;
    if (locked) await client.query("SELECT pg_advisory_unlock(hashtext($1))", [key]);
    return locked;
  });
}

/**
 * The state of every backend currently holding an advisory lock in this
 * database. `idle` proves the holder has no transaction open — the whole point
 * of R9-1; the transaction-scoped implementation this replaced would report
 * `idle in transaction` here for the length of the job body.
 */
async function advisoryLockHolderStates(): Promise<string[]> {
  return withOwnSession(async (client) => {
    const res = await client.query<{ state: string | null }>(`
      SELECT a.state
      FROM pg_locks l
      JOIN pg_stat_activity a ON a.pid = l.pid
      WHERE l.locktype = 'advisory' AND l.granted AND a.datname = current_database()`);
    return res.rows.map((r) => r.state ?? "unknown");
  });
}

describe("withJobLock", () => {
  beforeAll(async () => {
    // Applies the migrations and proves the test database is reachable; the
    // lock itself lives in shared memory, so no table is involved.
    await testDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  it("returns the body's value and refuses a concurrent call on the same key", async () => {
    const gate = deferred();
    const started = deferred();
    const key = "itest:jobs:concurrent";

    const first = withJobLock(key, async () => {
      started.resolve();
      await gate.promise;
      return "first-result";
    });

    // The contender runs while `first` is parked on the gate.
    await started.promise;
    const contended = await withJobLock(key, async () => "second-result");
    expect(contended).toBeNull();

    gate.resolve();
    expect(await first).toBe("first-result");

    // Released: the key is free again for the next tick.
    expect(await withJobLock(key, async () => "third-result")).toBe("third-result");
  });

  it("holds a session-level lock another connection can observe, and releases it", async () => {
    const gate = deferred();
    const key = "itest:jobs:observable";

    let observedWhileRunning: boolean | null = null;
    let holderStates: string[] = [];
    const run = withJobLock(key, async () => {
      observedWhileRunning = await tryLockFromAnotherSession(key);
      holderStates = await advisoryLockHolderStates();
      await gate.promise;
      return "done";
    });

    gate.resolve();
    expect(await run).toBe("done");

    expect(observedWhileRunning).toBe(false);
    // Held on a session with no transaction open, not on a transaction.
    expect(holderStates).toEqual(["idle"]);
    expect(await tryLockFromAnotherSession(key)).toBe(true);
  });

  it("lets the body open its own transaction and releases the lock when it throws", async () => {
    const key = "itest:jobs:throws";
    const userId = "00000000-0000-7000-8000-0000000000f1";

    let sawUserId: string | null = null;
    await expect(
      withJobLock(key, async () => {
        // Proves there is no enclosing transaction on the locked client: this
        // opens one on the pool and sets the RLS context inside it.
        await withUserContext(db, { userId }, async (tx) => {
          const res = await tx.execute<{ user_id: string }>(
            sql`SELECT current_setting('app.user_id', true) AS user_id`,
          );
          sawUserId = res.rows[0]?.user_id ?? null;
        });
        throw new Error("job body failed");
      }),
    ).rejects.toThrow("job body failed");

    expect(sawUserId).toBe(userId);
    expect(await tryLockFromAnotherSession(key)).toBe(true);
  });

  it("does not serialise different keys against each other", async () => {
    const gateA = deferred();
    const startedA = deferred();

    const a = withJobLock("itest:jobs:key-a", async () => {
      startedA.resolve();
      await gateA.promise;
      return "a";
    });
    await startedA.promise;

    // "key-a" is held for the whole of this call; a different key still runs.
    expect(await withJobLock("itest:jobs:key-b", async () => "b")).toBe("b");

    gateA.resolve();
    expect(await a).toBe("a");
  });
});
