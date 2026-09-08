import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env";
import * as schema from "./schema";

declare global {
  // eslint-disable-next-line no-var
  var __dashboardPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __dashboardDb: NodePgDatabase<typeof schema> | undefined;
}

function poolInstance(): Pool {
  if (!globalThis.__dashboardPool) {
    globalThis.__dashboardPool = new Pool({
      connectionString: env().DATABASE_URL,
      max: 8,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return globalThis.__dashboardPool;
}

function instance(): NodePgDatabase<typeof schema> {
  if (!globalThis.__dashboardDb) {
    globalThis.__dashboardDb = drizzle(poolInstance(), { schema });
  }
  return globalThis.__dashboardDb;
}

/**
 * The very pool `db` runs on, exposed for the one caller that needs a
 * connection of its own rather than a query: `withJobLock`
 * (`src/lib/repo/jobs.ts`) checks out a single client, takes a session-level
 * advisory lock on it and runs the job body with no transaction open. Anything
 * that only needs to run SQL must use `db`; checking out a client bypasses
 * Drizzle and, more importantly, the RLS context helpers.
 *
 * Lazy for the same reason `db` is (see below) — the proxy defers the env read
 * and the pool creation to the first property access.
 */
export const pool = new Proxy({} as Pool, {
  get(_target, prop, receiver) {
    const real = poolInstance() as unknown as Record<string | symbol, unknown>;
    const value = Reflect.get(real, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

/**
 * Lazy by construction. `next build` imports every route module to collect page
 * data, and at build time there is no DATABASE_URL — connecting (or even
 * validating env) at module scope fails the build. The proxy defers both the
 * env read and the pool creation to the first actual query.
 */
export const db = new Proxy({} as NodePgDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    const real = instance() as unknown as Record<string | symbol, unknown>;
    const value = Reflect.get(real, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export { schema };
