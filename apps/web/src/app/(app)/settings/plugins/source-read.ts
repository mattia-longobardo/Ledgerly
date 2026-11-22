// src/app/(app)/settings/plugins/source-read.ts — what the page of one source reads besides its
// connections (plugin-settings.md §2.2, §3.4), as the web process lends it to `/api/v1` (rewrite
// plan R3): the accounts deleted here, what waits to be written to the source, and what
// «Disconnect» of each connection leaves. Nothing here names a provider (rule M12).
import "server-only";
import type { SourceReads } from "@ledgerly/api";
import { listAccounts } from "@ledgerly/domain/accounts";
import {
  deletedSourceAccounts,
  listConnections,
  sourceSkippedIds,
} from "@ledgerly/domain/platform/integrations";
import { pendingCount } from "@ledgerly/domain/timeoff";
import { pendingSends } from "@ledgerly/domain/transactions";
import { connectionSummary } from "@ledgerly/plugin-host";
import { accountsLeft } from "./connection-state";
import { sourceOf } from "./deactivate";

export const sourceRead: SourceReads["source"] = async (ctx, slug) => {
  const source = await sourceOf(ctx, slug);
  if (source === null) return { ok: false, error: "not_found" };
  const [accounts, connections, deletedAccounts] = await Promise.all([
    listAccounts(ctx),
    listConnections(ctx),
    deletedSourceAccounts(ctx, source.provider),
  ]);
  const own = connections.filter((connection) => connection.provider === source.provider);
  const ids = accounts.filter((account) => account.provider === source.provider).map((account) => account.id);
  // What waits is read only while the source is connected, as the page did.
  const connected = own.length > 0;
  const [waiting, pendingDays, skipped] = await Promise.all([
    connected ? pendingSends(ctx, ids, 1000) : [],
    connected && source.days ? pendingCount(ctx) : 0,
    connected && source.pluginId === null ? sourceSkippedIds(ctx, source.provider) : new Set<string>(),
  ]);
  const answer = {
    provider: source.provider,
    deletedAccounts,
    unsent: { count: waiting.length, accountIds: [...new Set(waiting.map((one) => one.accountId))] },
    pendingDays,
    connections: await Promise.all(
      own.map(async (connection) => {
        // A source of the core keeps all its accounts here, and the ones left out (H55, point 4).
        if (source.pluginId === null) {
          return { id: connection.id, shared: null, leave: { accounts: ids.length, excluded: skipped.size } };
        }
        // A bank: the accounts here that its access reads; one deleted here is not one (N7.1 review).
        const summary = await connectionSummary(ctx, connection.id);
        return {
          id: connection.id,
          shared: summary.accounts,
          leave: {
            accounts: summary.chosen
              ? accountsLeft(accounts, source.provider, new Set(summary.accountIds))
              : 0,
            excluded: summary.skipped,
          },
        };
      }),
    ),
  };
  return { ok: true, answer };
};
