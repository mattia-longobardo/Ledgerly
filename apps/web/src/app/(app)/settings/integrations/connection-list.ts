// src/app/(app)/settings/integrations/connection-list.ts — the person's connections as data, for
// `GET /api/v1/connections` (rewrite plan R2): what the rows of the page show, without sentences.
// The capabilities are what a client of the API can ask for: the providers of the core keep their
// own cards on the web until R5c, so through the API they offer "Update now" only.
import "server-only";
import { listAccounts } from "@ledgerly/domain/accounts";
import { listInvestmentAccounts, providerOf } from "@ledgerly/domain/investments";
import type { Ctx } from "@ledgerly/domain/platform/context";
import {
  type Connection,
  isPluginProvider,
  listConnections,
  readSyncJob,
  type RecentRun,
  recentRuns,
  SYNC_RUN_RETENTION_DAYS,
} from "@ledgerly/domain/platform/integrations";
import { credentialsStatus, listUserPlugins } from "@ledgerly/domain/platform/plugins";
import { connectionSummary } from "@ledgerly/plugin-host";
import { labelOf } from "@/platform/integrations/registry";
import { sourceSlugOf } from "./connection-view";

const DAY_MS = 86_400_000;
/** The runs of a connection the list gives, newest first: the ten the row shows. */
const RUNS_SHOWN = 10;

interface Capabilities {
  sync: boolean;
  test: boolean;
  disconnect: boolean;
  chooseAccounts: boolean;
  renew: boolean;
  historyMonths: number[];
}

interface Facts {
  providerActive: boolean;
  accountsChosen: boolean;
  keyRefused: boolean;
  nextAttempt: Date | null;
  capabilities: Capabilities;
}

const NONE: Capabilities = {
  sync: false,
  test: false,
  disconnect: false,
  chooseAccounts: false,
  renew: false,
  historyMonths: [],
};

/** The end of a wait a bank asked for after "no more calls for now", while it lasts: the next attempt. */
export async function bankWait(ctx: Ctx, connectionId: string, now: Date): Promise<Date | null> {
  const until = (await readSyncJob(ctx, connectionId, "transactions"))?.cursor?.retryAfter;
  return until && new Date(until).getTime() > now.getTime() ? new Date(until) : null;
}

/**
 * The names of the accounts here whose IBAN a new account of a source carries (rewrite plan N4,
 * case 5), by connection. The accounts are read only when a connection has one: no query more otherwise (G9).
 */
export async function ibanConflictNames(ctx: Ctx, connections: readonly Connection[]) {
  const names = new Map(
    connections.some((connection) => (connection.ibanConflicts ?? []).length > 0)
      ? (await listAccounts(ctx, { includeArchived: true })).map((account) => [account.id, account.name])
      : [],
  );
  return (connection: Connection) => (connection.ibanConflicts ?? []).flatMap((id) => names.get(id) ?? []);
}

/** A plugin's connection: its plugin's state, its accounts chosen, the wait a bank asked for. */
async function bankFacts(
  ctx: Ctx,
  connection: Connection,
  plugin: { active: boolean; keyRefused: boolean },
  now: Date,
): Promise<Facts> {
  const summary = await connectionSummary(ctx, connection.id);
  const wait = await bankWait(ctx, connection.id, now);
  return {
    providerActive: plugin.active,
    accountsChosen: summary.chosen,
    keyRefused: plugin.keyRefused,
    nextAttempt: wait,
    capabilities: plugin.active
      ? { sync: true, test: false, disconnect: true, chooseAccounts: true, renew: true, historyMonths: [] }
      : NONE,
  };
}

const instant = (moment: Date | null) => moment?.toISOString() ?? null;

/** One connection as the contract says it. */
async function rowOf(
  ctx: Ctx,
  connection: Connection,
  facts: Facts,
  known: { runs: readonly RecentRun[]; ibanConflicts: (connection: Connection) => string[] },
) {
  const label = await labelOf(connection, ctx.locale);
  return {
    id: connection.id,
    provider: connection.provider,
    source: sourceSlugOf(connection.provider),
    name: label.name,
    providerName: label.provider,
    state: connection.state,
    errorCode: connection.errorCode,
    lastOkAt: instant(connection.lastOkAt),
    nextSyncAt: instant(connection.nextSyncAt),
    expiresAt: instant(connection.expiresAt),
    schedule: connection.schedule,
    ...facts,
    nextAttempt: instant(facts.nextAttempt),
    ibanConflicts: known.ibanConflicts(connection),
    runs: known.runs
      .filter((run) => run.connectionId === connection.id)
      .map(({ kind, state, origin, errorCode, counts, startedAt }) => ({
        kind,
        state,
        origin,
        errorCode,
        counts,
        startedAt: startedAt.toISOString(),
      })),
  };
}

/** Every connection of the person that a row shows: the core's, the plugins', the services'. */
export async function connectionList(ctx: Ctx, now: Date = new Date()) {
  const [connections, runs, plugins, services] = await Promise.all([
    listConnections(ctx),
    recentRuns(ctx, RUNS_SHOWN, new Date(now.getTime() - SYNC_RUN_RETENTION_DAYS * DAY_MS)),
    listUserPlugins(ctx),
    listInvestmentAccounts(ctx),
  ]);
  const ibanConflicts = await ibanConflictNames(ctx, connections);
  const refused = new Map<string, boolean>();
  const keyRefused = async (pluginId: string) => {
    if (!refused.has(pluginId)) refused.set(pluginId, (await credentialsStatus(ctx, pluginId)).invalid);
    return refused.get(pluginId) === true;
  };
  const rows = [];
  for (const connection of connections) {
    // A service of Investments has a row only while its account is there.
    if (
      providerOf(connection.provider) !== null &&
      !services.some((one) => one.provider === connection.provider)
    )
      continue;
    let facts: Facts = {
      providerActive: true,
      accountsChosen: true,
      keyRefused: false,
      nextAttempt: null,
      capabilities: { ...NONE, sync: true },
    };
    if (isPluginProvider(connection.provider)) {
      const pluginId = connection.provider.slice("plugin:".length);
      const active = plugins.some((one) => one.id === pluginId && one.state === "active");
      facts = await bankFacts(ctx, connection, { active, keyRefused: await keyRefused(pluginId) }, now);
    }
    rows.push(await rowOf(ctx, connection, facts, { runs, ibanConflicts }));
  }
  return rows;
}
