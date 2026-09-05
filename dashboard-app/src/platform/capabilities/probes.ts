import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import type { DbClient } from "@/lib/db/client";
import { integrationConnections } from "@/lib/db/schema";
import { documentStoreConfigured } from "@/modules/payroll/infrastructure/document-store-resolver";
import { withUserContext } from "@/platform/db/context";
import type { ConnectionStatus } from "@/platform/integrations/types";
import type { CapabilityProbes, IntegrationState } from "./resolve";

async function countIsNonZero(client: DbClient, query: ReturnType<typeof sql>): Promise<boolean> {
  const res = await client.execute<{ n: string }>(query);
  return (res.rows[0]?.n ?? "0") !== "0";
}

/**
 * The two data probes, bound to a database client.
 *
 * Both count inside `withUserContext`: `accounts` and `payroll_records` both
 * carry `FORCE ROW LEVEL SECURITY`, so the same count on the bare pool — with
 * no `app.user_id` set — sees no rows at all and answers "no data" for
 * everybody. `hasPayrollRecords` used to count the legacy `payslips` table on
 * the pool handle and ignore its `userId` argument entirely; Phase 4 moved
 * payroll into its own RLS-protected module, so it now counts what it is named
 * after, for the user it was asked about.
 *
 * Superseded records are excluded (Ruling R4-12): a user whose only record has
 * been superseded and not replaced has no earnings to show, and reporting
 * otherwise would send them to a page with an empty table and no explanation.
 */
export function dataProbes(client: DbClient): Pick<CapabilityProbes, "hasAccounts" | "hasPayrollRecords"> {
  return {
    hasAccounts: (userId) =>
      withUserContext(client, { userId }, (tx) =>
        countIsNonZero(tx, sql`SELECT count(*)::text AS n FROM accounts WHERE status <> 'archived'`),
      ),
    hasPayrollRecords: (userId) =>
      withUserContext(client, { userId }, (tx) =>
        countIsNonZero(tx, sql`SELECT count(*)::text AS n FROM payroll_records WHERE superseded_at IS NULL`),
      ),
  };
}

/** `disabled` reads as `disconnected` to the UI: both mean "nothing will sync". */
export function stateForStatus(status: ConnectionStatus | null): IntegrationState {
  if (status === null) return "not_configured";
  if (status === "connected") return "connected";
  if (status === "error") return "error";
  return "disconnected";
}

/**
 * Connection state per provider for a user, read straight from
 * `integration_connections` inside that user's own RLS context — a bare-pool
 * read would see no rows and answer "not connected" for everybody.
 */
export function connectionProbes(client: DbClient): Pick<CapabilityProbes, "connectionStates"> {
  return {
    connectionStates: (userId) =>
      withUserContext(client, { userId }, async (tx) => {
        const rows = await tx
          .select({ provider: integrationConnections.provider, status: integrationConnections.status })
          .from(integrationConnections)
          .where(eq(integrationConnections.userId, userId));
        const byProvider = new Map(rows.map((r) => [r.provider, r.status as ConnectionStatus]));
        return {
          wallet: stateForStatus(byProvider.get("wallet") ?? null),
          trek: stateForStatus(byProvider.get("trek") ?? null),
          // Widening `ProviderCode` widens this return type, so the third key is
          // required, not optional — the compiler is the call-site check.
          payroll_silo: stateForStatus(byProvider.get("payroll_silo") ?? null),
        };
      }),
  };
}

/**
 * The production wiring for `resolveCapabilities`. Kept apart from `resolve.ts`
 * so the resolver stays importable from a unit test: this file touches the
 * database, the environment and the filesystem, and is only ever imported by the
 * server layout.
 */
export const realProbes: CapabilityProbes = {
  // Phase 4: the document store's own config, not a database read. Both
  // driver cases are answerable without touching the database, which matters
  // because this runs on every request.
  payrollConfigured: () => documentStoreConfigured(),
  ...connectionProbes(db),
  ...dataProbes(db),
};
