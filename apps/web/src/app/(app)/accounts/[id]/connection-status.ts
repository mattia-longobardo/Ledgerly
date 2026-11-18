// The state of the connection an account comes from, for the header of the account's page
// (ux/n2-connection-status.md §3.3, decision Q3): the same state and the same sentence as the
// row of Settings › Integrations, in its short form. Read only for an account that has a
// provider: an account kept by hand asks nothing here.
import "server-only";
import "@/app/plugin-wiring";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { labelOf } from "@/platform/integrations/registry";
import { isPluginProvider } from "@ledgerly/domain/platform/integrations";
import {
  type Connection,
  listConnections,
  readSyncJob,
  recentRuns,
  SYNC_RUN_RETENTION_DAYS,
} from "@ledgerly/domain/platform/integrations";
import { credentialsStatus, isPluginActive } from "@ledgerly/domain/platform/plugins";
import { connectionSharing } from "@ledgerly/plugin-host";
import type { ConnectionRowProps } from "../../settings/integrations/connection-row";
import {
  type Capabilities,
  connectionRows,
  RUNS_PER_CONNECTION,
} from "../../settings/integrations/connection-view";

const SETTINGS = "/settings/integrations";

/**
 * The row of the connection that feeds an account, or `null` when the account has none: kept by
 * hand, or of a provider the person has disconnected. `keyHref`: where the provider's key is
 * replaced, when that is not Settings › Integrations (a service of Investments has its own page).
 */
export async function accountConnectionRow(
  ctx: Pick<Ctx, "userId" | "locale" | "timeZone">,
  account: { provider: string | null; providerAccountId: string | null },
  keyHref: string | null,
  now: Date,
): Promise<ConnectionRowProps | null> {
  if (account.provider === null) return null;
  const provider = account.provider;
  let connection: Connection | null;
  let capabilities: Capabilities = { update: true, replaceKey: keyHref ?? SETTINGS };
  let extra: {
    providerActive?: boolean;
    accountsChosen?: boolean;
    keyRefused?: boolean;
    nextAttempt?: Date | null;
  } = {};

  if (isPluginProvider(provider)) {
    // A plugin has one connection per bank: the one whose access shares this account.
    const pluginId = provider.slice("plugin:".length);
    const found =
      account.providerAccountId === null
        ? null
        : await connectionSharing(ctx, pluginId, account.providerAccountId);
    if (found === null) return null;
    connection = found.connection;
    const [active, credentials, job] = await Promise.all([
      isPluginActive(ctx, pluginId),
      credentialsStatus(ctx, pluginId),
      readSyncJob(ctx, connection.id, "transactions"),
    ]);
    const until = job?.cursor?.retryAfter ? new Date(job.cursor.retryAfter) : null;
    extra = {
      providerActive: active,
      accountsChosen: found.chosen,
      keyRefused: credentials.invalid,
      nextAttempt: until !== null && until.getTime() > now.getTime() ? until : null,
    };
    capabilities = active
      ? {
          update: true,
          renewHref: `/banks/connect?renew=${connection.id}`,
          replaceKey: `${SETTINGS}?replace=1`,
          chooseAccountsHref: `/banks/connect?step=accounts&c=${connection.id}`,
        }
      : { update: false };
  } else {
    connection = (await listConnections(ctx)).find((one) => one.provider === provider) ?? null;
    if (connection === null) return null;
  }

  const id = connection.id;
  const [rows, runs, label] = await Promise.all([
    connectionRows(ctx, now),
    recentRuns(ctx, RUNS_PER_CONNECTION, new Date(now.getTime() - SYNC_RUN_RETENTION_DAYS * 86_400_000)),
    labelOf(connection, ctx.locale),
  ]);
  return rows.row({
    connection,
    label,
    detail: null,
    runs: runs.filter((run) => run.connectionId === id),
    capabilities,
    ...extra,
  });
}
