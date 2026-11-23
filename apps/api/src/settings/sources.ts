// Users and settings · what the pages of the sources read (rewrite plan R3): the steps of a bank's
// connection, the person's plugins, the page of one source and the log of the readings. The steps
// and the page of a source need the web's bank sink and registry of sources: the web process lends
// them (`SourceReads`, like `ConnectionCases`) until E5 and R4. Reads only: nothing changes here.
import type { Hono } from "hono";
import type { z } from "zod";
import { type RouteContract, SETTINGS } from "@ledgerly/api-contract";
import { providerOf } from "@ledgerly/domain/investments";
import type { Ctx } from "@ledgerly/domain/platform/context";
import {
  type Connection,
  findConnection,
  isPluginProvider,
  isSyncErrorCode,
  listRuns,
  PROVIDERS,
  SYNC_RUN_RETENTION_DAYS,
} from "@ledgerly/domain/platform/integrations";
import { credentialsStatus, isBankPluginProvider, listUserPlugins } from "@ledgerly/domain/platform/plugins";
import { keepManifestsFresh, returnAddress } from "@ledgerly/plugin-host";
import { type ApiEnv, ApiRefusal, type Guard, serve } from "../serve";

const { sources } = SETTINGS;

type Answer<R extends RouteContract> = z.input<NonNullable<R["response"]>>;
type Refused = { ok: false; error?: string };

/** The reads the web process lends until E5 and R4: the pages of the web call the same ones. */
export interface SourceReads {
  choice(
    ctx: Ctx,
    connection: Connection,
    options: { all: boolean },
  ): Promise<{ ok: true; answer: Answer<typeof sources.getBankChoice> } | Refused>;
  outcome(
    ctx: Ctx,
    connection: Connection,
    options: { same: string | null },
  ): Promise<{ ok: true; answer: Answer<typeof sources.getBankOutcome> } | Refused>;
  source(ctx: Ctx, slug: string): Promise<{ ok: true; answer: Answer<typeof sources.getSource> } | Refused>;
}

/**
 * The page of a source (plugin-settings.md §2.1): a plugin's id, or the id of a provider of the
 * core. The investment services have none: their settings are on the service's page (§1.1, row 17).
 */
export function sourceSlugOf(provider: string): string | null {
  if (isPluginProvider(provider)) return provider.slice("plugin:".length);
  if (providerOf(provider) !== null) return null;
  return PROVIDERS.some((one) => one === provider) ? provider : null;
}

const DAY_MS = 86_400_000;
const RUN_PAGE = 50;
const MAX_RUNS = 200;

/** The answer of a read of the web, or its refusal as the contract names it. */
function body<T>(read: { ok: true; answer: T } | Refused): T {
  if (read.ok) return read.answer;
  if (read.error === "not_found") throw new ApiRefusal("not_found");
  throw new ApiRefusal("conflict", read.error ?? "failed");
}

/** A connection of a plugin of the person: another person's, or not a bank's, is not found. */
async function bankOf(ctx: Ctx, id: string): Promise<Connection> {
  const connection = await findConnection(ctx, id);
  if (!connection || !(await isBankPluginProvider(connection.provider))) throw new ApiRefusal("not_found");
  return connection;
}

function servePlugins(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, sources.listPlugins, async ({ ctx }) => {
    // The manifests are read in the background, as the page did: the answer never waits for a plugin.
    keepManifestsFresh();
    const plugins = await listUserPlugins(ctx);
    return {
      plugins: await Promise.all(
        plugins.map(async (plugin) => {
          const credentials = await credentialsStatus(ctx, plugin.id);
          return {
            id: plugin.id,
            name: plugin.name,
            description: plugin.description,
            state: plugin.state,
            pausedSince: plugin.pausedSince?.toISOString() ?? null,
            connections: plugin.connections,
            credentials: { ...credentials, savedAt: credentials.savedAt?.toISOString() ?? null },
            returnAddress: returnAddress(plugin.id),
            countries: plugin.countries,
            kind: plugin.kind,
            fields: plugin.fields,
          };
        }),
      ),
    };
  });
}

function serveRuns(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, sources.listConnectionRuns, async ({ ctx, query }) => {
    if (query.connectionId !== undefined && !(await findConnection(ctx, query.connectionId)))
      throw new ApiRefusal("not_found");
    const asked = Number(query.limit ?? RUN_PAGE);
    const limit = Math.min(Math.max(asked, 1), MAX_RUNS);
    // One more than the page: whether there are more to show.
    const runs = await listRuns(ctx, {
      connectionId: query.connectionId,
      since: new Date(Date.now() - SYNC_RUN_RETENTION_DAYS * DAY_MS),
      limit: limit + 1,
    });
    return {
      runs: runs.slice(0, limit).map((run) => ({
        id: run.id,
        connectionId: run.connectionId,
        kind: run.kind,
        state: run.state,
        origin: run.origin,
        errorCode: isSyncErrorCode(run.errorCode) ? run.errorCode : null,
        counts: run.counts,
        httpStatus: run.httpStatus,
        appVersion: run.appVersion,
        startedAt: run.startedAt.toISOString(),
        finishedAt: run.finishedAt?.toISOString() ?? null,
      })),
      more: runs.length > limit,
    };
  });
}

export function serveSources(app: Hono<ApiEnv>, guard: Guard, reads: SourceReads): readonly RouteContract[] {
  // `/connections/runs` before the routes of one connection.
  serveRuns(app, guard);
  serve(app, guard, sources.getBankChoice, async ({ ctx, params, query }) =>
    body(await reads.choice(ctx, await bankOf(ctx, params.id), { all: query.all === "1" })),
  );
  serve(app, guard, sources.getBankOutcome, async ({ ctx, params, query }) =>
    body(await reads.outcome(ctx, await bankOf(ctx, params.id), { same: query.same ?? null })),
  );
  servePlugins(app, guard);
  serve(app, guard, sources.getSource, async ({ ctx, params }) => body(await reads.source(ctx, params.slug)));
  return Object.values(sources);
}
