// scripts/perf-vacuum.ts — before every sample of `npm run perf` (scripts/perf-on-test.sh): each
// sample builds sixty thousand movements and deletes them, and the runs before it leave the indexes
// of `transactions` swollen (103-116 MB), which slows every later sample. A full vacuum gives each
// sample, of the code and of the reference, the same database. `DATABASE_URL` is the test database:
// the script that runs this checks it.
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (
  !connectionString?.endsWith("_test") &&
  !connectionString?.endsWith("_test_2") &&
  !connectionString?.endsWith("_test_3")
)
  throw new Error("refusing: DATABASE_URL is not a test database");

const pool = new Pool({ connectionString, max: 1 });
try {
  // The tables the application owns; the catalogs are skipped with a notice.
  await pool.query("VACUUM (FULL, ANALYZE)");
} finally {
  await pool.end();
}
