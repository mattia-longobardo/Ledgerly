import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { env, trekConfig } from "@/lib/env";
import type { CapabilityProbes } from "./resolve";

async function countIsNonZero(query: ReturnType<typeof sql>): Promise<boolean> {
  const res = await db.execute<{ n: string }>(query);
  return (res.rows[0]?.n ?? "0") !== "0";
}

/**
 * The production wiring for `resolveCapabilities`. Kept apart from `resolve.ts`
 * so the resolver stays importable from a unit test: this file touches the
 * database, the environment and the filesystem, and is only ever imported by the
 * server layout.
 */
export const realProbes: CapabilityProbes = {
  walletConfigured: () => {
    try {
      return readFileSync(env().WALLET_TOKEN_FILE, "utf8").trim().length > 0;
    } catch {
      return false;
    }
  },
  trekConfigured: () => trekConfig() !== null,
  // Replaced by the document-store probe in Phase 4.
  payrollConfigured: () => Boolean(env().PAPERLESS_URL),
  hasAccounts: () => countIsNonZero(sql`SELECT count(*)::text AS n FROM accounts`),
  hasPayrollRecords: () => countIsNonZero(sql`SELECT count(*)::text AS n FROM payslips WHERE status = 'verified'`),
};
