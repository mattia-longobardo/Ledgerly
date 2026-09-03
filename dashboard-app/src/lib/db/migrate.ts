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
 */
await db.execute(sql`
  INSERT INTO funds (id, slug, name) VALUES
    (1, 'fideuram', 'Fideuram'),
    (2, 'cometa', 'Fondo Cometa')
  ON CONFLICT (id) DO UPDATE
    SET slug = EXCLUDED.slug,
        name = EXCLUDED.name
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
