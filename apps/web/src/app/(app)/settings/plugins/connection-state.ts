// The state of a connection for `GET /connections` (ux/n2-connection-status.md §2): the facts of the
// connection become the state, its sentence and its one action, by the one rule of the server
// (`syncStatus`). The rows of the pages are built from the answer (`connection-view.ts`).
//
// Nothing here names a provider.
import "server-only";
import "@/app/plugin-wiring";
import { sourceSlugOf } from "@ledgerly/api";
import type { Connection, RecentRun } from "@ledgerly/domain/platform/integrations";
import { isRunningNow, type SyncStatus, syncStatus } from "@ledgerly/domain/platform/integrations";

/** What the state of a connection is decided from. */
interface ConnectionFacts {
  connection: Connection;
  /** The last runs of this connection, newest first. */
  runs: readonly RecentRun[];
  /** False for a connection of a plugin the person turned off. */
  providerActive?: boolean;
  /** False while the accounts of the connection are not chosen. */
  accountsChosen?: boolean;
  /** The provider refuses the person's key: every connection it opens asks for a new one. */
  keyRefused?: boolean;
}

/** The page of a source: `/api/v1` answers it too (`source` of `GET /source-categories`). */
export { sourceSlugOf };

/** Where the settings of a source are; `null` for a provider without a page of its own. */
export function sourceHref(provider: string): string | null {
  const slug = sourceSlugOf(provider);
  return slug === null ? null : `/settings/plugins/${slug}`;
}

/**
 * The accounts here that a bank's access reads, and that stay "Disconnected" after "Disconnect":
 * the accounts of `provider` whose id is one of the access's. An account deleted here is not one of
 * them, even when the bank still has it (plugin-settings.md §4.2).
 */
export function accountsLeft(
  accounts: readonly { provider: string | null; providerAccountId: string | null }[],
  provider: string,
  ids: ReadonlySet<string>,
): number {
  return accounts.filter(
    (account) =>
      account.provider === provider &&
      account.providerAccountId !== null &&
      ids.has(account.providerAccountId),
  ).length;
}

/** The state of a connection from what the page read about it. */
export function statusOf(facts: ConnectionFacts, now: Date): SyncStatus {
  const { connection } = facts;
  return syncStatus(
    {
      state: connection.state,
      errorCode: facts.keyRefused ? "auth" : connection.errorCode,
      consecutiveFailures: connection.consecutiveFailures,
      lastOkAt: connection.lastOkAt,
      nextSyncAt: connection.nextSyncAt,
      expiresAt: connection.expiresAt,
      running: facts.runs.some((run) => isRunningNow(run, now)),
      providerActive: facts.providerActive ?? true,
      scheduled: connection.schedule.rules.length > 0,
      accountsChosen: facts.accountsChosen ?? true,
    },
    now,
  );
}
