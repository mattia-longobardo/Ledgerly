// test/integration-setup.ts — runs once before the integration project.
import { Pool } from "pg";
import { runMigrations } from "../src/platform/db/migrate";

export default async function setup(): Promise<void> {
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
