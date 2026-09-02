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
 * The fund registry is structural, not user data: the Teable column names are
 * the ones verified against the live Allocation table. Idempotent so the
 * entrypoint can run it on every boot.
 */
await db.execute(sql`
  INSERT INTO funds (id, slug, name, teable_column) VALUES
    (1, 'fideuram', 'Fideuram', 'Fideuram'),
    (2, 'cometa', 'Fondo Cometa', 'Fondo Cometa')
  ON CONFLICT (id) DO UPDATE
    SET slug = EXCLUDED.slug,
        name = EXCLUDED.name,
        teable_column = EXCLUDED.teable_column
`);

/**
 * The hand-tracked account registry, seeded with the same five accounts that
 * were previously a hardcoded array (`slug → label → teable_column`).
 *
 * This is a BOOTSTRAP seed, not the funds' `ON CONFLICT DO UPDATE`: it fires
 * only while the table is empty. The difference is deliberate — a fund is never
 * deleted, so re-asserting it on every boot is harmless, but a tracked account
 * CAN be deleted from Settings, and the whole point of the delete is that it is
 * permanent. A per-slug upsert would resurrect a deleted account on the next
 * deploy; the `WHERE NOT EXISTS` guard makes the seed a one-time act, so once
 * the owner has the registry, boots leave it entirely alone (label, column,
 * visibility, order and membership are all his to change and keep).
 */
await db.execute(sql`
  INSERT INTO tracked_accounts (slug, label, teable_column, sort_order)
  SELECT * FROM (VALUES
    ('etoro', 'EToro', 'EToro', 1),
    ('buddy_bank', 'Buddy Bank', 'Buddy Bank', 2),
    ('isybank', 'IsyBank', 'IsyBank', 3),
    ('mediolanum', 'Mediolanum', 'Mediolanum', 4),
    ('binance', 'Binance', 'Binance', 5)
  ) AS seed(slug, label, teable_column, sort_order)
  WHERE NOT EXISTS (SELECT 1 FROM tracked_accounts)
`);

/**
 * Bootstrap the owner from the legacy allowlist, once. After this the users
 * table governs access and AUTHORIZED_SUB is read only while the table is empty.
 */
const bootstrapSub = process.env.AUTHORIZED_SUB;
if (bootstrapSub) {
  await bootstrapOwner(db, { subject: bootstrapSub, email: process.env.AUTHORIZED_EMAIL ?? null });
}

console.log("migrations applied and fund + tracked-account registries seeded");
await pool.end();
