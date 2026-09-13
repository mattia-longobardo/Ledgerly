// test/integration-setup.ts — runs once before the integration project.
import { existsSync } from "node:fs";
import { Pool } from "pg";
import { runMigrations } from "../src/platform/db/migrate";

export default async function setup(): Promise<void> {
  if (!existsSync("./drizzle/meta/_journal.json")) return; // no migration generated yet
  const pool = new Pool({
    connectionString:
      process.env.TEST_DATABASE_URL ?? "postgres://finance:finance@127.0.0.1:55432/finance_test",
    max: 1,
  });
  try {
    await runMigrations(pool, "./drizzle");
  } finally {
    await pool.end();
  }
}
