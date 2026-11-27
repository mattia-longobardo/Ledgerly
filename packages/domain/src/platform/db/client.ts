import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import { readEnv } from "../env";
import * as tables from "./tables";

export type Db = NodePgDatabase<typeof tables>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** A request that finds no free connection fails after this, and does not wait for ever (SEC-09). */
const CONNECT_TIMEOUT_MS = 10_000;

// Cached on globalThis so `next dev` hot reloads do not open a new pool each time.
const cache = globalThis as unknown as { ledgerlyPool?: Pool; ledgerlyDb?: Db };

export function getPool(): Pool {
  cache.ledgerlyPool ??= new Pool({
    connectionString: readEnv().DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  });
  return cache.ledgerlyPool;
}

export function getDb(): Db {
  cache.ledgerlyDb ??= drizzle(getPool(), { schema: tables });
  return cache.ledgerlyDb;
}

/**
 * Gives `fn` a connection of its own, outside the pool, for a hold that lasts as long as a job or a
 * reading (SEC-09): the holds never take the pool's connections, so the writes done while they
 * hold always find one, and the requests of everyone else too.
 */
export async function withOwnConnection<T>(work: (db: Db) => Promise<T>): Promise<T> {
  // A hold inside a hold (job → reading → run) never waits: it would wait for itself.
  if (insideHold.getStore()) return connectOwn(work);
  while (holds >= MAX_OWN_HOLDS) await new Promise<void>((resolve) => waiting.push(resolve));
  holds++;
  try {
    return await insideHold.run(true, () => connectOwn(work));
  } finally {
    holds--;
    waiting.shift()?.();
  }
}

/**
 * Holds at once in this process, the outermost ones only. A hold nests at most 3 connections (the
 * lock of a job, the lock of a reading, its run), so a process opens at most 6 of its own: the
 * Postgres is shared with the rest of the homelab. The others wait in turn.
 */
export const MAX_OWN_HOLDS = 2;
let holds = 0;
const waiting: (() => void)[] = [];
const insideHold = new AsyncLocalStorage<true>();

async function connectOwn<T>(work: (db: Db) => Promise<T>): Promise<T> {
  const client = new Client({
    connectionString: readEnv().DATABASE_URL,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  });
  // A connection lost while idle emits `error`; the next query fails with it, the process must not.
  client.on("error", () => {});
  await client.connect();
  try {
    return await work(drizzle(client, { schema: tables }));
  } finally {
    await client.end();
  }
}
