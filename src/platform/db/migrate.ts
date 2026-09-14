import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool } from "pg";

const MIGRATION_LOCK_KEY = 7_243_911;

/**
 * Applies pending migrations. The advisory lock is session-level and taken on one
 * dedicated connection, so two containers starting together migrate one after the other.
 */
export async function runMigrations(pool: Pool, migrationsFolder: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    try {
      await migrate(drizzle({ client }), { migrationsFolder });
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}
