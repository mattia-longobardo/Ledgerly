// tests/e2e/global-setup.ts
import { execFileSync } from "node:child_process";
import { Pool } from "pg";
import { clearMailbox } from "../../test/mailpit";
import { truncateAllTables } from "../../test/truncate";
import { E2E_ENV } from "./env";

export default async function globalSetup(): Promise<void> {
  const pool = new Pool({ connectionString: E2E_ENV.DATABASE_URL, max: 1 });
  try {
    await truncateAllTables(pool);
  } finally {
    await pool.end();
  }
  await clearMailbox();
  execFileSync("node", ["--conditions=react-server", "--import", "tsx", "scripts/seed-e2e.ts"], {
    stdio: "inherit",
    env: { ...process.env, ...E2E_ENV },
  });
}
