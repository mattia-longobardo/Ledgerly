import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { readEnv } from "@/platform/env";
import * as tables from "./tables";

export type Db = NodePgDatabase<typeof tables>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// Cached on globalThis so `next dev` hot reloads do not open a new pool each time.
const cache = globalThis as unknown as { financePool?: Pool; financeDb?: Db };

export function getPool(): Pool {
  cache.financePool ??= new Pool({ connectionString: readEnv().DATABASE_URL, max: 10 });
  return cache.financePool;
}

export function getDb(): Db {
  cache.financeDb ??= drizzle(getPool(), { schema: tables });
  return cache.financeDb;
}
