// Users and settings · connections, banks, sources and plugins (rewrite plan R2). The steps that
// still need the web's registry of providers and its bank sink are lent by the web process
// (`ConnectionCases`, like the guard) until E5 and R4; what is the domain's or the plugin host's
// is called here. The providers of the core are reached by their cards, by the provider's id
// (R5c anticipated): their refusal is the card's code in `reason`.
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
  previewSchedule,
  saveSchedule,
} from "@ledgerly/domain/platform/integrations";
import { getAuth } from "@ledgerly/domain/platform/auth";
import { isBankPluginProvider } from "@ledgerly/domain/platform/plugins";
import {
  PluginActionError,
  removeUserCredentials,
  saveUserCredentials,
  setPluginActive,
} from "@ledgerly/plugin-host";
import { type ApiEnv, ApiRefusal, type Guard, serve } from "../serve";

const { connections, banks } = SETTINGS;

type Refused = { ok: false; error?: string };
type CoreAccount = { externalId: string; name: string; here: string | null; chosen: boolean };
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
  /** `runs`: the last runs of each connection to give, 10 when not asked. */
  list(ctx: Ctx, runs?: number): Promise<z.input<typeof connections.listConnections.response>["connections"]>;
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
  ): Promise<{ ok: true; counts: z.input<typeof banks.getSourceDeactivation.response> } | { ok: false }>;
  /** H56: the refusal says why (`not_active`, `reading_in_progress` with `startedAt`, `plugin_down`, …). */
  turnOff(
    ctx: Ctx,
    slug: string,
    headers: Headers,
    options: { force?: boolean; stopReading?: boolean },
  ): Promise<{ ok: true; accounts: number } | { ok: false; error: string; startedAt?: Date }>;
  bringBack(
    ctx: Ctx,
    slug: string,
    externalId: string,
    headers: Headers,
  ): Promise<{ ok: true; reconnect: string | null } | { ok: false }>;
  /** Starts an access to a bank, bound to the browser's session that asks. */
  startBankAccess(
    ctx: Ctx,
    sessionId: string,
    institution: { country: string; name: string },
  ): Promise<{ ok: true; url: string } | Refused>;
  renewBankAccess(
    ctx: Ctx,
    sessionId: string,
    connectionId: string,
  ): Promise<{ ok: true; url: string } | Refused>;
  /** The card of a plugin read by the core (R5c): `input` says the refusal is of the credential. */
  connectCore(
    ctx: Ctx,
    provider: string,
    credentials: Record<string, string>,
  ): Promise<{ ok: true; id: string; back: number } | { ok: false; error: string; input: boolean }>;
  coreAccounts(ctx: Ctx, connection: Connection): Promise<{ ok: true; accounts: CoreAccount[] } | Refused>;
  chooseCoreAccounts(
    ctx: Ctx,
    connection: Connection,
    chosen: string[],
  ): Promise<{ ok: true; added: number } | Refused>;
  disconnectCore(ctx: Ctx, connection: Connection): Promise<{ ok: true } | Refused>;
}

/** A provider with a card: neither a bank's plugin nor a service of Investments (a plugin read by an engine of the core). */
const isCore = async (provider: string) =>
  !(await isBankPluginProvider(provider)) && providerOf(provider) === null;

/** The connection of the person, or `not_found`; another person's id is not found either. */
async function connectionOf(ctx: Ctx, id: string): Promise<Connection> {
  const connection = await findConnection(ctx, id);
  if (!connection) throw new ApiRefusal("not_found");
  return connection;
}

/** A bank's connection: what only a plugin's connection does. */
async function bankOf(ctx: Ctx, id: string): Promise<Connection> {
  const connection = await connectionOf(ctx, id);
  if (!(await isBankPluginProvider(connection.provider))) {
    throw new ApiRefusal("conflict", "not_a_bank");
  }
  return connection;
}

/** A refusal of a use case of the web as the contract names it; a card's connection gone is not found. */
function settled<T extends { ok: true }>(answer: T | Refused): T {
  if (answer.ok) return answer;
  if (answer.error === "not_found" || answer.error === "notConnected") throw new ApiRefusal("not_found");
  throw new ApiRefusal("conflict", answer.error ?? "failed");
}

/** The browser's session that asks: an access to a bank is bound to it (its return checks it). */
async function sessionIdOf(headers: Headers): Promise<string> {
  const session = headers.has("authorization") ? null : await (await getAuth()).api.getSession({ headers });
  if (!session) throw new ApiRefusal("conflict", "no_session");
  return session.session.id;
}

/** A refusal of a run in the contract's closed list: an unknown code is `failed`, as its toast is. */
function refusalOf(refusal: string): (typeof CONNECTION_REFUSALS)[number] {
  if (refusal === "notActive") return "not_active";
  return CONNECTION_REFUSALS.find((code) => code === refusal) ?? "failed";
}

function serveRuns(app: Hono<ApiEnv>, guard: Guard, cases: ConnectionCases): void {
  const run = async (ctx: Ctx, id: string, kind: Kind, options: { months?: number; headers: Headers }) => {
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

/** «Choose the accounts» of a bank or of a provider of the core. */
function serveConnectionAccounts(app: Hono<ApiEnv>, guard: Guard, cases: ConnectionCases): void {
  serve(app, guard, connections.listConnectionAccounts, async ({ ctx, params }) => {
    const connection = await connectionOf(ctx, params.id);
    if (!(await isCore(connection.provider)))
      return settled(await cases.exposedAccounts(ctx, await bankOf(ctx, params.id)));
    const { accounts } = settled(await cases.coreAccounts(ctx, connection));
    return {
      accounts: accounts.map((one) => ({
        providerAccountId: one.externalId,
        name: one.name,
        currency: null,
        here: one.here,
        chosen: one.chosen,
      })),
    };
  });
  serve(app, guard, connections.chooseConnectionAccounts, async ({ ctx, params, body, headers }) => {
    const connection = await connectionOf(ctx, params.id);
    const kept = body.decisions.filter((one) => one.target.kind !== "skip");
    if (await isCore(connection.provider)) {
      const chosen = kept.map((one) => one.providerAccountId);
      return { added: settled(await cases.chooseCoreAccounts(ctx, connection, chosen)).added };
    }
    settled(await cases.importAccounts(ctx, await bankOf(ctx, params.id), body.decisions, headers));
    return { added: kept.length };
  });
}

function serveConnectionRoutes(app: Hono<ApiEnv>, guard: Guard, cases: ConnectionCases): void {
  serve(app, guard, connections.listConnections, async ({ ctx, query }) => {
    const list = await cases.list(ctx, query.runs);
    return { connections: list };
  });
  serve(app, guard, connections.connect, async ({ ctx, body }) => {
    if (!(await isCore(body.provider))) throw new ApiRefusal("conflict", "not_by_credentials");
    const outcome = await cases.connectCore(ctx, body.provider, body.credentials);
    // No card for the provider: a plugin or a service of Investments connects another way.
    if (!outcome.ok && outcome.error === "notConnected")
      throw new ApiRefusal("conflict", "not_by_credentials");
    if (!outcome.ok) throw new ApiRefusal(outcome.input ? "invalid" : "conflict", outcome.error);
    return { id: outcome.id, restoredAccounts: outcome.back };
  });
  serve(app, guard, connections.disconnect, async ({ ctx, params }) => {
    const connection = await connectionOf(ctx, params.id);
    if (await isCore(connection.provider)) settled(await cases.disconnectCore(ctx, connection));
    else settled(await cases.cancelBank(ctx, (await bankOf(ctx, params.id)).id));
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
  serveConnectionAccounts(app, guard, cases);
  serveRuns(app, guard, cases);
}

function serveBanksAndSources(app: Hono<ApiEnv>, guard: Guard, cases: ConnectionCases): void {
  serve(app, guard, banks.listBanks, async ({ ctx, query }) => ({
    banks: settled(await cases.listBanks(ctx, query.country)).banks,
  }));
  serve(app, guard, banks.startBankAccess, async ({ ctx, body, headers }) => ({
    url: settled(await cases.startBankAccess(ctx, await sessionIdOf(headers), body)).url,
  }));
  serve(app, guard, banks.renewBankAccess, async ({ ctx, params, headers }) => ({
    url: settled(await cases.renewBankAccess(ctx, await sessionIdOf(headers), params.id)).url,
  }));
  serve(app, guard, banks.readBankNow, async ({ ctx, params, headers }) => {
    settled(await cases.readBankNow(ctx, (await bankOf(ctx, params.id)).id, headers));
  });
  serve(app, guard, banks.getSourceDeactivation, async ({ ctx, params }) => {
    const answer = await cases.deactivation(ctx, params.slug);
    if (!answer.ok) throw new ApiRefusal("not_found");
    return answer.counts;
  });
  serve(app, guard, banks.deactivateSource, async ({ ctx, params, body, headers }) => {
    const answer = await cases.turnOff(ctx, params.slug, headers, body ?? {});
    if (answer.ok) return { accounts: answer.accounts };
    if (answer.error === "not_found") throw new ApiRefusal("not_found");
    // H56: the causes the client says; anything else is «nothing changed», as before.
    const reason = TURN_OFF_REFUSALS.find((one) => one === answer.error) ?? "not_turned_off";
    throw new ApiRefusal("conflict", reason, undefined, { startedAt: answer.startedAt?.toISOString() });
  });
  serve(app, guard, banks.resumeSourceAccount, async ({ ctx, params, headers }) => {
    const answer = await cases.bringBack(ctx, params.slug, params.externalId, headers);
    if (!answer.ok) throw new ApiRefusal("not_found");
    return { reconnect: answer.reconnect };
  });
}

/** The causes of a refusal of «Turn off» the client says (H56). */
const TURN_OFF_REFUSALS = ["not_active", "reading_in_progress", "plugin_down"] as const;

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

/** The routes of the connections, the banks, the sources and the plugins. */
export function serveConnections(
  app: Hono<ApiEnv>,
  guard: Guard,
  cases: ConnectionCases,
): readonly RouteContract[] {
  serveConnectionRoutes(app, guard, cases);
  serveBanksAndSources(app, guard, cases);
  servePlugins(app, guard);
  return [...Object.values(connections), ...Object.values(banks)];
}
