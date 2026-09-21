// test/db.ts — helpers for *.itest.ts files (Vitest only: the client imports `server-only`).
import { getPool } from "@/platform/db/client";
import { truncateAllTables } from "./truncate";

/** Empties every application table, keeping the migrations journal. Call in `beforeEach`. */
export async function resetDatabase(): Promise<void> {
  await truncateAllTables(getPool());
}

/** Closes the shared pool. Call in `afterAll`. */
export async function closeDatabase(): Promise<void> {
  await getPool().end();
  const cache = globalThis as unknown as { ledgerlyPool?: unknown; ledgerlyDb?: unknown };
  cache.ledgerlyPool = undefined;
  cache.ledgerlyDb = undefined;
}
