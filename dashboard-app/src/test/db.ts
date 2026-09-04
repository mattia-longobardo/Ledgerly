import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "@/lib/db/schema";

let pool: Pool | null = null;
let db: NodePgDatabase<typeof schema> | null = null;
let migrated = false;

export async function testDb(): Promise<NodePgDatabase<typeof schema>> {
  if (db) return db;
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is required for integration tests");
  pool = new Pool({ connectionString: url, max: 4 });
  db = drizzle(pool, { schema });
  if (!migrated) {
    await migrate(db, { migrationsFolder: "./drizzle" });
    migrated = true;
  }
  return db;
}

/**
 * Tables the migrations own outright. They hold no test data, no row a test
 * creates points at them, and clearing them would discard a catalogue only a
 * migration knows how to write — so a test needing it back would have to keep a
 * second copy of the migration's seed in sync by hand.
 */
const STATIC_TABLES = ["integration_providers"];

/** Clear everything except drizzle's own bookkeeping and the static catalogues. */
export async function resetDb(): Promise<void> {
  const d = await testDb();
  const res = await d.execute<{ table_name: string }>(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name NOT LIKE '__drizzle%'`);
  const names = res.rows
    .filter((r) => !STATIC_TABLES.includes(r.table_name))
    .map((r) => `"${r.table_name}"`);
  if (names.length) await d.execute(sql.raw(`TRUNCATE ${names.join(", ")} RESTART IDENTITY CASCADE`));
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = null;
  db = null;
}
