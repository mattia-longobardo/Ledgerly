// test/integration-setup.ts — runs once before the integration project.
import { Pool } from "pg";
import { runMigrations } from "../src/platform/db/migrate";

/**
 * Drops and recreates the `public` and `drizzle` schemas before every integration run, so
 * `runMigrations` always applies from an empty database (spec §11) instead of from whatever the
 * previous run left behind. Guarded on the database name: this must never run against anything
 * but the `ledgerly_test` database `TEST_DATABASE_URL` points at.
 */
async function resetTestDatabase(pool: Pool): Promise<void> {
  const {
    rows: [{ current_database: database }],
  } = await pool.query<{ current_database: string }>("SELECT current_database()");
  if (!database.endsWith("_test")) {
    throw new Error(`Refusing to reset "${database}": not a _test database`);
  }
  await pool.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
  await pool.query("CREATE SCHEMA public");
}

export default async function setup(): Promise<void> {
  // Set by scripts/test-integration.sh: the separate `ledgerly_test` database of the homelab.
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) throw new Error("TEST_DATABASE_URL is not set: run `npm run test:integration`");
  const pool = new Pool({ connectionString, max: 1 });
  try {
    await resetTestDatabase(pool);
    await runMigrations(pool, "./drizzle");
  } finally {
    await pool.end();
  }
}
