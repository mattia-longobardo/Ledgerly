// test/integration-setup.ts — runs once before the integration project.
import { Pool } from "pg";
import { runMigrations } from "@domain/platform/db/migrate";

/**
 * Drops and recreates the `public` and `drizzle` schemas before every integration run, so
 * `runMigrations` always applies from an empty database (spec §11) instead of from whatever the
 * previous run left behind. Guarded on the database name: this must never run against anything
 * but the `ledgerly_<shard>_test` (or `ledgerly_test_2`) database `TEST_DATABASE_URL` points at.
 */
async function resetTestDatabase(pool: Pool): Promise<void> {
  const {
    rows: [{ current_database: database }],
  } = await pool.query<{ current_database: string }>("SELECT current_database()");
  if (!/_test(_\d+)?$/.test(database)) {
    throw new Error(`Refusing to reset "${database}": not a _test database`);
  }
  await pool.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
  await pool.query("CREATE SCHEMA public");
}

/**
 * The signing keys the run leaves behind are encrypted with the test secret of vitest.config.ts. The
 * full suite then starts its preview and `npm run perf` on `ledgerly_1_test` with the secret of the
 * environment file, and Better Auth fails on the keys it cannot decrypt ("Failed to decrypt private
 * key"): no access token, so the MCP and Client API flows and G9 go red. The keys go with the run.
 */
async function removeSigningKeys(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 1 });
  try {
    await pool.query("DELETE FROM jwks");
  } finally {
    await pool.end();
  }
}

export default async function setup(): Promise<() => Promise<void>> {
  // Set by scripts/test-integration.sh: the shard's own `ledgerly_<n>_test` database of the homelab.
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) throw new Error("TEST_DATABASE_URL is not set: run `npm run test:integration`");
  const pool = new Pool({ connectionString, max: 1 });
  try {
    await resetTestDatabase(pool);
    await runMigrations(pool, "./drizzle");
  } finally {
    await pool.end();
  }
  return () => removeSigningKeys(connectionString);
}
