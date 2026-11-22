// Users and settings · connections, banks, sources and plugins (rewrite plan R2). The steps that
// still need the web's registry of providers and its bank sink are lent by the web process
// (`ConnectionCases`, like the guard) until E5 and R4; what is the domain's or the plugin host's
// is called here. The providers of the core keep their cards on the web until R5c: what only they
// do answers `409`, reason `core_provider`.
import type { Hono } from "hono";
import type { z } from "zod";
import {
  CONNECTION_REFUSALS,
  type RouteContract,
  SCHEDULE_PREVIEW_COUNT,
  SETTINGS,
} from "@ledgerly/api-contract";
import { providerOf } from "@ledgerly/domain/investments";
import type { Ctx } from "@ledgerly/domain/platform/context";
import {
  type Connection,
  findConnection,
  IntegrationError,
  isPluginProvider,
  previewSchedule,
  saveSchedule,
} from "@ledgerly/domain/platform/integrations";
import {
  PluginActionError,
  removeUserCredentials,
  saveUserCredentials,
  setPluginActive,
} from "@ledgerly/plugin-host";
import { type ApiEnv, ApiRefusal, type Guard, serve } from "../serve";

const { connections, banks } = SETTINGS;

type Refused = { ok: false; error?: string };
type Kind = "update" | "resume" | "enable" | "test" | "history";

interface ExposedAccount {
  providerAccountId: string;
  name: string;
  currency: string | null;
  here: string | null;
  chosen: boolean;
}

interface Decision {
  providerAccountId: string;
  target:
    { kind: "new"; name: string; type: string } | { kind: "existing"; accountId: string } | { kind: "skip" };
}

/** The use cases the web process lends until E5 and R4: the Server Actions call the same ones. */
export interface ConnectionCases {
  list(ctx: Ctx): Promise<z.input<typeof connections.listConnections.response>["connections"]>;
  run(
    ctx: Ctx,
    connectionId: string,
    kind: Kind,
    options: { months?: number; headers: Headers },
  ): Promise<{ ok: true } | { ok: false; refusal: string; found: boolean }>;
  exposedAccounts(
    ctx: Ctx,
    connection: Connection,
  ): Promise<{ ok: true; accounts: ExposedAccount[] } | Refused>;
  importAccounts(
    ctx: Ctx,
    connection: Connection,
    decisions: Decision[],
    headers: Headers,
  ): Promise<{ ok: true } | Refused>;
  listBanks(
    ctx: Ctx,
    country: string,
  ): Promise<
    { ok: true; banks: { name: string; maxAccessDays: number | null; connected: boolean }[] } | Refused
  >;
  readBankNow(ctx: Ctx, connectionId: string, headers: Headers): Promise<{ ok: true } | Refused>;
  cancelBank(ctx: Ctx, connectionId: string): Promise<{ ok: true } | Refused>;
  deactivation(
    ctx: Ctx,
    slug: string,
  ): Promise<
    | {
        ok: true;
        counts: { accounts: number; categories: number; rules: number; unsent: number; pendingDays: number };
      }
    | { ok: false }
  >;
  turnOff(ctx: Ctx, slug: string, headers: Headers): Promise<{ ok: true; accounts: number } | { ok: false }>;
  bringBack(
    ctx: Ctx,
    slug: string,
    externalId: string,
    headers: Headers,
  ): Promise<{ ok: true; reconnect: string | null } | { ok: false }>;
}

/** A provider of the core: neither a plugin nor a service of Investments. */
const isCore = (provider: string) => !isPluginProvider(provider) && providerOf(provider) === null;

/** The connection of the person, or `not_found`; another person's id is not found either. */
async function connectionOf(ctx: Ctx, id: string): Promise<Connection> {
  const connection = await findConnection(ctx, id);
  if (!connection) throw new ApiRefusal("not_found");
  return connection;
}

/** A bank's connection: what only a plugin's connection does. */
export async function bankOf(ctx: Ctx, id: string): Promise<Connection> {
  const connection = await connectionOf(ctx, id);
  if (!isPluginProvider(connection.provider)) {
    throw new ApiRefusal("conflict", isCore(connection.provider) ? "core_provider" : "not_a_bank");
  }
  return connection;
}

/** A refusal of a use case of the web as the contract names it. */
export function settled<T extends { ok: true }>(answer: T | Refused): T {
  if (answer.ok) return answer;
  if (answer.error === "not_found") throw new ApiRefusal("not_found");
  throw new ApiRefusal("conflict", answer.error ?? "failed");
}

/** A refusal of a run in the contract's closed list: an unknown code is `failed`, as its toast is. */
function refusalOf(refusal: string): (typeof CONNECTION_REFUSALS)[number] {
  if (refusal === "notActive") return "not_active";
  return CONNECTION_REFUSALS.find((code) => code === refusal) ?? "failed";
}

function serveRuns(app: Hono<ApiEnv>, guard: Guard, cases: ConnectionCases): void {
  const run = async (ctx: Ctx, id: string, kind: Kind, options: { months?: number; headers: Headers }) => {
    if (kind === "test" || kind === "history") {
      const connection = await connectionOf(ctx, id);
      if (isCore(connection.provider)) throw new ApiRefusal("conflict", "core_provider");
    }
    const outcome = await cases.run(ctx, id, kind, options);
    if (outcome.ok) return;
    if (!outcome.found) throw new ApiRefusal("not_found");
    throw new ApiRefusal("conflict", refusalOf(outcome.refusal));
  };
  serve(app, guard, connections.syncNow, ({ ctx, params, headers }) =>
    run(ctx, params.id, "update", { headers }),
  );
  serve(app, guard, connections.testConnection, ({ ctx, params, headers }) =>
    run(ctx, params.id, "test", { headers }),
  );
  serve(app, guard, connections.rereadHistory, ({ ctx, params, body, headers }) =>
    run(ctx, params.id, "history", { months: body.months, headers }),
  );
  serve(app, guard, connections.resumeConnection, ({ ctx, params, headers }) =>
    run(ctx, params.id, "resume", { headers }),
  );
  serve(app, guard, connections.enableConnection, ({ ctx, params, headers }) =>
    run(ctx, params.id, "enable", { headers }),
  );
}

function serveConnectionRoutes(app: Hono<ApiEnv>, guard: Guard, cases: ConnectionCases): void {
  serve(app, guard, connections.listConnections, async ({ ctx }) => ({ connections: await cases.list(ctx) }));
  serve(app, guard, connections.connect, ({ body }) => {
    throw new ApiRefusal("conflict", isCore(body.provider) ? "core_provider" : "not_by_credentials");
  });
  serve(app, guard, connections.disconnect, async ({ ctx, params }) => {
    settled(await cases.cancelBank(ctx, (await bankOf(ctx, params.id)).id));
  });
  serve(app, guard, connections.setSchedule, async ({ ctx, params, body }) => {
    const connection = await connectionOf(ctx, params.id);
    try {
      await saveSchedule(ctx, connection.id, body);
    } catch (error) {
      if (error instanceof IntegrationError) throw new ApiRefusal("invalid", "schedule");
      throw error;
    }
  });
  serve(app, guard, connections.previewSchedule, async ({ ctx, params, body }) => {
    await connectionOf(ctx, params.id);
    const preview = previewSchedule(body.rules, ctx.timeZone, new Date(), SCHEDULE_PREVIEW_COUNT);
    return { next: preview.next.map((instant) => instant.toISOString()), problems: preview.problems };
  });
  serve(app, guard, connections.listConnectionAccounts, async ({ ctx, params }) =>
    settled(await cases.exposedAccounts(ctx, await bankOf(ctx, params.id))),
  );
  serve(app, guard, connections.chooseConnectionAccounts, async ({ ctx, params, body, headers }) => {
    settled(await cases.importAccounts(ctx, await bankOf(ctx, params.id), body.decisions, headers));
    return { added: body.decisions.filter((one) => one.target.kind !== "skip").length };
  });
  serveRuns(app, guard, cases);
}

function serveBanksAndSources(app: Hono<ApiEnv>, guard: Guard, cases: ConnectionCases): void {
  serve(app, guard, banks.listBanks, async ({ ctx, query }) => ({
    banks: settled(await cases.listBanks(ctx, query.country)).banks,
  }));
  serve(app, guard, banks.readBankNow, async ({ ctx, params, headers }) => {
    settled(await cases.readBankNow(ctx, (await bankOf(ctx, params.id)).id, headers));
  });
  serve(app, guard, banks.getSourceDeactivation, async ({ ctx, params }) => {
    const answer = await cases.deactivation(ctx, params.slug);
    if (!answer.ok) throw new ApiRefusal("not_found");
    return answer.counts;
  });
  serve(app, guard, banks.deactivateSource, async ({ ctx, params, headers }) => {
    const answer = await cases.turnOff(ctx, params.slug, headers);
    if (!answer.ok) throw new ApiRefusal("conflict", "not_turned_off");
    return { accounts: answer.accounts };
  });
  serve(app, guard, banks.resumeSourceAccount, async ({ ctx, params, headers }) => {
    const answer = await cases.bringBack(ctx, params.slug, params.externalId, headers);
    if (!answer.ok) throw new ApiRefusal("not_found");
    return { reconnect: answer.reconnect };
  });
}

/** A refusal of the plugin host as the contract names it. */
async function pluginAction(work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    if (!(error instanceof PluginActionError)) throw error;
    if (error.code === "not_found") throw new ApiRefusal("not_found");
    const invalid =
      error.code === "key_format" || error.code === "credentials_invalid" || error.code === "missing";
    throw new ApiRefusal(invalid ? "invalid" : "conflict", error.code);
  }
}

function servePlugins(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, banks.setPluginActive, ({ ctx, params, body }) =>
    pluginAction(() => setPluginActive(ctx, { pluginId: params.pluginId, active: body.active })),
  );
  serve(app, guard, banks.savePluginCredentials, ({ ctx, params, body }) =>
    pluginAction(() => saveUserCredentials(ctx, { pluginId: params.pluginId, ...body })),
  );
  serve(app, guard, banks.removePluginCredentials, ({ ctx, params }) =>
    pluginAction(() => removeUserCredentials(ctx, params.pluginId)),
  );
}

/** The routes of the connections; the start and the renewal of a bank's access come with §6 #4. */
export function serveConnections(
  app: Hono<ApiEnv>,
  guard: Guard,
  cases: ConnectionCases,
): readonly RouteContract[] {
  serveConnectionRoutes(app, guard, cases);
  serveBanksAndSources(app, guard, cases);
  servePlugins(app, guard);
  const later: readonly RouteContract[] = [banks.startBankAccess, banks.renewBankAccess];
  return [...Object.values(connections), ...Object.values(banks)].filter((route) => !later.includes(route));
}
