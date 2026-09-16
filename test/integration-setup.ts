// test/integration-setup.ts — runs once before the integration project.
import { Pool } from "pg";
import { runMigrations } from "../src/platform/db/migrate";

// The one place the default TEST_DATABASE_URL literal lives; vitest.config.ts falls back to the
// same value when TEST_DATABASE_URL is unset. Not imported there: that would pull this file's own
// imports (pg, drizzle) into Vite's config-loading, which does not tolerate extension-less
// relative imports.
export const DEFAULT_TEST_DATABASE_URL = "postgres://ledgerly:ledgerly@127.0.0.1:55432/ledgerly_test";

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
  const pool = new Pool({
    connectionString: process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL,
    max: 1,
  });
  try {
    await resetTestDatabase(pool);
    await runMigrations(pool, "./drizzle");
  } finally {
    await pool.end();
  }
}
