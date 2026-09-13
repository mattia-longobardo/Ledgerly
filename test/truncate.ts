// test/truncate.ts — imports nothing from src/, so both Vitest and Playwright's global setup can load it.
import type { ClientBase, Pool } from "pg";

/** Empties every table of the public schema; drizzle's journal lives in the `drizzle` schema and stays. */
export async function truncateAllTables(db: Pool | ClientBase): Promise<void> {
  const { rows } = await db.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  );
  if (rows.length === 0) return;
  const names = rows.map((row) => `"${row.tablename}"`).join(", ");
  await db.query(`TRUNCATE ${names} RESTART IDENTITY CASCADE`);
}
