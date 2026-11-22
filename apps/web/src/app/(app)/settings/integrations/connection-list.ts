// src/app/(app)/settings/integrations/connection-list.ts — the person's connections as data, for
// `GET /api/v1/connections` (rewrite plan R2): what the rows of the page show, without sentences.
// The capabilities are what a client of the API can ask for: a provider of the core offers what its
// card does (`core-cases.ts`), a bank what its plugin does, an investment service "Update now".
import "server-only";
import { coreCardOf } from "./core-cases";
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
import { labelOf, passFor } from "@/platform/integrations/registry";
import { sourceSlugOf, statusOf } from "./connection-view";

const DAY_MS = 86_400_000;
/** The runs of a connection the list gives, newest first, when not asked for more: the ten a row shows. */
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
  /** The accounts a bank's access shares; null for a connection that is not a plugin's. */
  shared: number | null;
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
    shared: summary.accounts,
    providerActive: plugin.active,
    accountsChosen: summary.chosen,
    keyRefused: plugin.keyRefused,
    nextAttempt: wait,
    capabilities: plugin.active
      ? { sync: true, test: false, disconnect: true, chooseAccounts: true, renew: true, historyMonths: [] }
      : NONE,
  };
}

/** What the card of a provider of the core does through the API; "Update now" only for anybody else. */
function coreCapabilities(provider: string): Capabilities {
  const card = coreCardOf(provider);
  if (!card) return { ...NONE, sync: true };
  return {
    ...NONE,
    sync: true,
    test: true,
    disconnect: true,
    chooseAccounts: card.accounts !== undefined,
    historyMonths: card.history ? [...(passFor(provider)?.history?.choices ?? [])] : [],
  };
}

const instant = (moment: Date | null) => moment?.toISOString() ?? null;

/** One connection as the contract says it. */
async function rowOf(
  ctx: Ctx,
  connection: Connection,
  facts: Facts,
  known: {
    runs: readonly RecentRun[];
    ibanConflicts: (connection: Connection) => string[];
    service: { accountId: string } | null;
    now: Date;
  },
) {
  const label = await labelOf(connection, ctx.locale);
  // The depth read today, as «History» of the source's page says it: one query, for a provider with one.
  const history = passFor(connection.provider)?.history;
  const historyDepth = history
    ? history.depthOf((await readSyncJob(ctx, connection.id, "transactions"))?.cursor)
    : null;
  const runs = known.runs.filter((run) => run.connectionId === connection.id);
  return {
    id: connection.id,
    provider: connection.provider,
    source: sourceSlugOf(connection.provider),
    name: label.name,
    providerName: label.provider,
    state: connection.state,
    errorCode: connection.errorCode,
    consecutiveFailures: connection.consecutiveFailures,
    lastOkAt: instant(connection.lastOkAt),
    nextSyncAt: instant(connection.nextSyncAt),
    expiresAt: instant(connection.expiresAt),
    schedule: connection.schedule,
    ...facts,
    nextAttempt: instant(facts.nextAttempt),
    ibanConflicts: known.ibanConflicts(connection),
    historyDepth,
    service: known.service,
    // The state of the row, by the same rule as the page's (`syncStatus`): the client says it.
    status: statusOf({ connection, runs, ...facts }, known.now),
    runs: runs.map(({ kind, state, origin, errorCode, counts, startedAt }) => ({
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
export async function connectionList(ctx: Ctx, now: Date = new Date(), runsShown: number = RUNS_SHOWN) {
  const [connections, runs, plugins, services] = await Promise.all([
    listConnections(ctx),
    recentRuns(ctx, runsShown, new Date(now.getTime() - SYNC_RUN_RETENTION_DAYS * DAY_MS)),
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
    const investment = providerOf(connection.provider);
    const account = services.find((one) => one.provider === connection.provider);
    if (investment !== null && account === undefined) continue;
    // A service with a key has its settings on its account's page.
    const service = investment?.connect === "apikey" && account ? { accountId: account.accountId } : null;
    let facts: Facts = {
      shared: null,
      providerActive: true,
      accountsChosen: true,
      keyRefused: false,
      nextAttempt: null,
      capabilities: coreCapabilities(connection.provider),
    };
    if (isPluginProvider(connection.provider)) {
      const pluginId = connection.provider.slice("plugin:".length);
      const active = plugins.some((one) => one.id === pluginId && one.state === "active");
      facts = await bankFacts(ctx, connection, { active, keyRefused: await keyRefused(pluginId) }, now);
    }
    rows.push(await rowOf(ctx, connection, facts, { runs, ibanConflicts, service, now }));
  }
  return rows;
}
