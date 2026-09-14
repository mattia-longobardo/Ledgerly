// `npm run db:migrate` locally; bundled to /app/migrate.mjs in the image.
import { Pool } from "pg";
import { runMigrations } from "../src/platform/db/migrate";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

const pool = new Pool({ connectionString, max: 1 });
try {
  await runMigrations(pool, process.env.MIGRATIONS_FOLDER ?? "./drizzle");
  console.log("[migrate] schema is up to date");
} finally {
  await pool.end();
}
