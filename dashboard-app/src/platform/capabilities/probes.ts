import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import type { DbClient } from "@/lib/db/client";
import { integrationConnections } from "@/lib/db/schema";
import { env } from "@/lib/env";
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
 * `hasAccounts` counts inside `withUserContext`: `accounts` carries
 * `FORCE ROW LEVEL SECURITY`, so the same count on the bare pool — with no
 * `app.user_id` set — sees no rows at all and answers "no accounts" for
 * everybody. `payslips` has no RLS yet (it moves into its own module in Phase
 * 4), so its count runs as it always has and simply ignores the user.
 *
 * Split from `realProbes` so an integration test can point the pair at a test
 * database instead of the app-wide `db` proxy, which would need the whole
 * environment to resolve.
 */
export function dataProbes(client: DbClient): Pick<CapabilityProbes, "hasAccounts" | "hasPayrollRecords"> {
  return {
    hasAccounts: (userId) =>
      withUserContext(client, { userId }, (tx) =>
        countIsNonZero(tx, sql`SELECT count(*)::text AS n FROM accounts WHERE status <> 'archived'`),
      ),
    hasPayrollRecords: () =>
      countIsNonZero(client, sql`SELECT count(*)::text AS n FROM payslips WHERE status = 'verified'`),
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
  // Replaced by the document-store probe in Phase 4.
  payrollConfigured: () => Boolean(env().PAPERLESS_URL),
  ...connectionProbes(db),
  ...dataProbes(db),
};
