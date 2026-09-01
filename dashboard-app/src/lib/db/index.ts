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

function pool(): Pool {
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
    globalThis.__dashboardDb = drizzle(pool(), { schema });
  }
  return globalThis.__dashboardDb;
}

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
