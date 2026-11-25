// src/app/(app)/settings/plugins/plugin-standing.ts — how each plugin of the person stands (decision
// H56), as the web process lends it to `GET /api/v1/plugins`: the worst health of its connections,
// by the same rule as their rows, and what still depends on it here, what «Deactivate» converts.
// Nothing here names a provider (rule M12).
import "server-only";
import type { SourceReads } from "@ledgerly/api";
import { listAccounts } from "@ledgerly/domain/accounts";
import { healthOf, pluginProvider, worstHealth } from "@ledgerly/domain/platform/integrations";
import { pendingCount } from "@ledgerly/domain/timeoff";
import { pendingSends, sourceCategoryCount } from "@ledgerly/domain/transactions";
import { connectionList } from "./connection-list";

export const pluginStanding: SourceReads["standing"] = async (ctx, plugins) => {
  const [rows, accounts] = await Promise.all([
    connectionList(ctx),
    listAccounts(ctx, { includeArchived: true }),
  ]);
  // The days off wait for the calendar, whichever it is: read once, only when there is one.
  const days = plugins.some((plugin) => plugin.kind === "calendar") ? await pendingCount(ctx) : 0;
  const standing = await Promise.all(
    plugins.map(async (plugin) => {
      const provider = pluginProvider(plugin.id);
      const ids = accounts.filter((account) => account.provider === provider).map((account) => account.id);
      const [categories, pendingTx] = await Promise.all([
        sourceCategoryCount(ctx, provider),
        // shortcut: counts up to 1000 waiting movements, as the dialog of «Deactivate»; more shows 1000.
        pendingSends(ctx, ids, 1000).then((waiting) => waiting.length),
      ]);
      const health = worstHealth(
        rows.filter((row) => row.provider === provider).map((row) => healthOf(row.status, row)),
      );
      const leftovers = {
        accounts: ids.length,
        categories,
        pendingTx,
        pendingDays: plugin.kind === "calendar" ? days : 0,
      };
      return [plugin.id, { health, leftovers }] as const;
    }),
  );
  return new Map(standing);
};
