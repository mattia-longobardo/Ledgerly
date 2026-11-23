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
  for (const schema of ["drizzle", "public"]) {
    await dropTablesInGroups(pool, schema);
    // What is left — sequences, types, functions — is a handful of locks.
    await pool.query(`DROP SCHEMA IF EXISTS ${quoted(schema)} CASCADE`);
  }
  await pool.query("CREATE SCHEMA public");
}

/** The tables dropped at once, each group in its own transaction (a statement of the pool commits). */
const TABLES_PER_DROP = 10;

const quoted = (name: string) => `"${name.replace(/"/g, '""')}"`;

/**
 * The tables of a schema, a few at a time. `DROP SCHEMA … CASCADE` takes a lock on every table, index,
 * sequence and constraint in one transaction: several hundred, and four shards doing it together run
 * out of the lock table the homelab's Postgres shares between its databases (`max_locks_per_transaction`
 * 64, "out of shared memory"). A group holds a few dozen, released at its commit.
 */
async function dropTablesInGroups(pool: Pool, schema: string): Promise<void> {
  const { rows } = await pool.query<{ name: string }>(
    "SELECT tablename AS name FROM pg_tables WHERE schemaname = $1 ORDER BY tablename",
    [schema],
  );
  for (let start = 0; start < rows.length; start += TABLES_PER_DROP) {
    const names = rows
      .slice(start, start + TABLES_PER_DROP)
      .map((row) => `${quoted(schema)}.${quoted(row.name)}`);
    await pool.query(`DROP TABLE IF EXISTS ${names.join(", ")} CASCADE`);
  }
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
  } catch (error) {
    // Vite prints a failed global setup through its source maps, and can lose the error on the way
    // ("code.charCodeAt is not a function"): the cause is written here first.
    console.error("[integration-setup] the test database could not be prepared:", error);
    throw error;
  } finally {
    await pool.end();
  }
  return () => removeSigningKeys(connectionString);
}
