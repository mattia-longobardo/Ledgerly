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

/** Truncate everything except drizzle's own bookkeeping. */
export async function resetDb(): Promise<void> {
  const d = await testDb();
  const res = await d.execute<{ table_name: string }>(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name NOT LIKE '__drizzle%'`);
  const names = res.rows.map((r) => `"${r.table_name}"`);
  if (names.length) await d.execute(sql.raw(`TRUNCATE ${names.join(", ")} RESTART IDENTITY CASCADE`));
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = null;
  db = null;
}
