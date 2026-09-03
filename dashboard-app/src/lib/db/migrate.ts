import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "./schema";
import { bootstrapOwner } from "./bootstrap";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required to run migrations");

const pool = new Pool({ connectionString: url, max: 1 });
const db = drizzle(pool, { schema });

await migrate(db, { migrationsFolder: "./drizzle" });

/**
 * The fund registry is structural, not user data. Idempotent so the
 * entrypoint can run it on every boot.
 *
 * Update-then-insert rather than a single `ON CONFLICT DO UPDATE`: Postgres
 * checks NOT NULL on the proposed row before conflict resolution, so during
 * the Phase 1 two-wave deploy (migrations 0004–0006 applied, 0007 not yet)
 * the legacy `funds.teable_column NOT NULL` still exists and a plain upsert
 * fails on rows that are only being updated. Existing rows are updated
 * without touching that column; only genuinely missing rows are inserted.
 */
await db.execute(sql`
  UPDATE funds AS f
  SET slug = seed.slug, name = seed.name
  FROM (VALUES (1, 'fideuram', 'Fideuram'), (2, 'cometa', 'Fondo Cometa')) AS seed(id, slug, name)
  WHERE f.id = seed.id
`);
await db.execute(sql`
  INSERT INTO funds (id, slug, name)
  SELECT seed.id, seed.slug, seed.name
  FROM (VALUES (1, 'fideuram', 'Fideuram'), (2, 'cometa', 'Fondo Cometa')) AS seed(id, slug, name)
  WHERE NOT EXISTS (SELECT 1 FROM funds f WHERE f.id = seed.id)
`);

/**
 * Bootstrap the owner from the legacy allowlist, once. After this the users
 * table governs access and AUTHORIZED_SUB is read only while the table is empty.
 */
const bootstrapSub = process.env.AUTHORIZED_SUB;
if (bootstrapSub) {
  await bootstrapOwner(db, { subject: bootstrapSub, email: process.env.AUTHORIZED_EMAIL ?? null });
}

console.log("migrations applied and fund registry seeded");
await pool.end();
