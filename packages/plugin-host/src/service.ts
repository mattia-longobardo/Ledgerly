/**
 * The core's side of a plugin (rewrite plan, 04-now.md §4.1 and §4.2): reading the manifest,
 * turning a plugin on for one person, sealing that person's credentials, and taking an access to
 * a provider from its start to the connection it leaves.
 *
 * Every function is `(ctx, input)` and none imports Next.js: the Server Actions and the return
 * route are thin wrappers around these. No call to a plugin happens inside a database
 * transaction, and no error carries what a plugin or a provider said: only a code.
 */
import { randomBytes } from "node:crypto";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { openJson, sealJson } from "@ledgerly/domain/platform/crypto";
import { getDb, type Tx } from "@ledgerly/domain/platform/db";
import { userScoped } from "@ledgerly/domain/platform/db";
import { readEnv } from "@ledgerly/domain/platform/env";
import { pluginProvider } from "@ledgerly/domain/platform/integrations";
import {
  changeSourceSkippedIds,
  clearErrorCode,
  type Connection,
  deleteConnection,
  IntegrationError,
  readCredentials,
  savePluginConnection,
  sourceSkippedIds,
} from "@ledgerly/domain/platform/integrations";
import { callPlugin, type Fetch, PluginCallError } from "./client";
import {
  accountSchema,
  authCompleteResponseSchema,
  authRevokeResponseSchema,
  authStartResponseSchema,
  type InstitutionsResponse,
  institutionsResponseSchema,
  PLUGIN_PATHS,
  type PluginAccount,
  verifyResponseSchema,
} from "@ledgerly/plugin-contract";
import { hasCapability, manifestSchema } from "@ledgerly/plugin-contract";
import {
  configuredPlugins,
  findInstancePlugin,
  type InstancePlugin,
  isPluginActive,
  listPluginConnections,
} from "@ledgerly/domain/platform/plugins";
import {
  AUTH_STATE_MINUTES,
  hashState,
  instanceKeyOf,
  looksLikePrivateKey,
  normalizePrivateKey,
  providerAccountIdOf,
  type ReturnError,
} from "@ledgerly/domain/platform/plugins";
import {
  pluginActivations,
  pluginAuthStates,
  plugins,
  pluginUserCredentials,
} from "@ledgerly/domain/platform/plugins";
import { keyRing } from "@ledgerly/domain/platform/crypto";

/** Why a plugin action refused: the codes of ux/n1-plugin-bank.md §7, plus the two of a guard. */
export type PluginActionCode =
  | "not_found"
  | "not_active"
  | "missing"
  | "key_format"
  | "credentials_invalid"
  | "write_not_allowed"
  | "unreachable"
  | "plugin_down"
  | "auth"
  | "consent_expired"
  | "rate_limited"
  | "provider_down"
  | "bank_unavailable"
  | "invalid_data"
  | "connected"
  | "no_choice"
  /** A new account would take an IBAN an account here already has (rewrite plan N4, H39). */
  | "iban_exists"
  | "failed";

export class PluginActionError extends Error {
  constructor(readonly code: PluginActionCode) {
    super(code);
    this.name = "PluginActionError";
  }
}

/** For the tests: the `fetch` the calls to a plugin go through. */
export interface Deps {
  fetchFn?: Fetch;
}

/* The manifest */

const MANIFEST_MAX_AGE_MS = 3_600_000;
const MANIFEST_TIMEOUT_MS = 3_000;

/**
 * Reads the manifest of every configured plugin that has none, or an old one, and keeps it. The
 * core does this by itself (H25: nobody registers a plugin): a page that lists plugins calls it
 * first, and a plugin that does not answer simply keeps the manifest it had — or stays unseen.
 */
export async function refreshManifests(now: Date = new Date(), deps: Deps = {}): Promise<void> {
  const known = configuredPlugins();
  if (known.length === 0) return;
  const rows = await getDb().select({ id: plugins.id, readAt: plugins.manifestReadAt }).from(plugins);
  for (const plugin of known) {
    const row = rows.find((one) => one.id === plugin.id);
    if (row && now.getTime() - row.readAt.getTime() < MANIFEST_MAX_AGE_MS) continue;
    try {
      const manifest = await callPlugin(plugin, PLUGIN_PATHS.manifest, manifestSchema, {
        timeoutMs: MANIFEST_TIMEOUT_MS,
        fetchFn: deps.fetchFn,
      });
      // A plugin answers for its own id only. One that speaks a contract this core does not is
      // kept as it answered, so the diagnostics can say so: nobody can use it (`acceptsContract`
      // is asked again by every reader).
      if (manifest.id !== plugin.id) continue;
      const values = {
        url: plugin.url,
        manifest,
        contract: manifest.contract,
        state: "ready",
        manifestReadAt: now,
        unreachableSince: null,
      };
      await getDb()
        .insert(plugins)
        .values({ id: plugin.id, ...values })
        .onConflictDoUpdate({ target: plugins.id, set: { ...values, updatedAt: now } });
    } catch (error) {
      if (!(error instanceof PluginCallError)) throw error;
      // The start of the series of failed checks is kept: a later failure does not move it.
      if (row) {
        await getDb()
          .update(plugins)
          .set({ state: "unreachable", unreachableSince: sql`coalesce(${plugins.unreachableSince}, ${now})` })
          .where(eq(plugins.id, plugin.id));
      }
    }
  }
}

const MANIFEST_CHECK_EVERY_MS = 300_000;
let nextManifestCheck = 0;

/**
 * The same reading, for a caller that comes round often (the health check, every few seconds): it
 * asks the database at most once in five minutes per process, never waits and never throws. This
 * is what reads a manifest "at start and at intervals" without a job of its own.
 */
export function keepManifestsFresh(now: Date = new Date()): void {
  if (now.getTime() < nextManifestCheck) return;
  nextManifestCheck = now.getTime() + MANIFEST_CHECK_EVERY_MS;
  refreshManifests(now).catch((error: unknown) => {
    console.error(
      "[plugins] the manifests could not be read",
      error instanceof Error ? error.name : "unknown",
    );
  });
}

async function requirePlugin(pluginId: string): Promise<InstancePlugin> {
  const plugin = await findInstancePlugin(pluginId);
  // The prices plugin serves the instance: no person turns it on or gives it credentials (R5d).
  if (!plugin || hasCapability(plugin.manifest, "prices.daily")) throw new PluginActionError("not_found");
  return plugin;
}

/** The plugin, for an action only a person who has turned it on may take (H25). */
export async function requireActivePlugin(
  ctx: Pick<Ctx, "userId">,
  pluginId: string,
): Promise<InstancePlugin> {
  const plugin = await requirePlugin(pluginId);
  if (!(await isPluginActive(ctx, pluginId))) throw new PluginActionError("not_active");
  return plugin;
}

/* Turning a plugin on and off, for one person */

/**
 * Turns a plugin on or off for this person and nobody else. Neither calls the plugin: it is a
 * preference. Turning it off keeps the credentials and the connections sealed (decision H30).
 */
export async function setPluginActive(
  ctx: Pick<Ctx, "userId">,
  input: { pluginId: string; active: boolean },
  now: Date = new Date(),
): Promise<void> {
  await requirePlugin(input.pluginId);
  const change = input.active ? { active: true, activatedAt: now } : { active: false, deactivatedAt: now };
  await getDb()
    .insert(pluginActivations)
    .values(userScoped(ctx).stamp({ pluginId: input.pluginId, ...change }))
    .onConflictDoUpdate({
      target: [pluginActivations.userId, pluginActivations.pluginId],
      set: { ...change, updatedAt: now },
    });
}

/* The credentials of one person */

async function readUserCredentials(
  ctx: Pick<Ctx, "userId">,
  pluginId: string,
): Promise<Record<string, string> | null> {
  const [row] = await getDb()
    .select({ credentials: pluginUserCredentials.credentials })
    .from(pluginUserCredentials)
    .where(and(userScoped(ctx).owns(pluginUserCredentials), eq(pluginUserCredentials.pluginId, pluginId)));
  return row ? openJson(keyRing(), row.credentials) : null;
}

export async function requireUserCredentials(
  ctx: Pick<Ctx, "userId">,
  pluginId: string,
): Promise<Record<string, string>> {
  const credentials = await readUserCredentials(ctx, pluginId);
  if (credentials === null) throw new PluginActionError("missing");
  return credentials;
}

/** Records that the provider refuses this person's credentials, so the screens can say so (§4.4). */
export async function markCredentialsInvalid(
  ctx: Pick<Ctx, "userId">,
  pluginId: string,
  now: Date,
): Promise<void> {
  await getDb()
    .update(pluginUserCredentials)
    .set({ invalidAt: now })
    .where(
      and(
        userScoped(ctx).owns(pluginUserCredentials),
        eq(pluginUserCredentials.pluginId, pluginId),
        isNull(pluginUserCredentials.invalidAt),
      ),
    );
}

const MAX_KEY_LENGTH = 16_384;
const MAX_ID_LENGTH = 200;

/**
 * Checks a person's credentials with the provider and, only when it accepts them, seals and keeps
 * them (§4.1, §4.2). `applicationId` left empty keeps the saved one: that is "Replace key". An
 * application that can also make payments is refused (decision H26).
 *
 * The plaintext lives in this function's arguments and in the body of one call to the plugin. It
 * is not logged, not returned, and a refusal carries a code and nothing of what was typed.
 */
export async function saveUserCredentials(
  ctx: Pick<Ctx, "userId">,
  input: { pluginId: string; applicationId: string; privateKey: string },
  now: Date = new Date(),
  deps: Deps = {},
): Promise<void> {
  const plugin = await requireActivePlugin(ctx, input.pluginId);
  const typedId = input.applicationId.trim();
  const saved = typedId === "" ? await readUserCredentials(ctx, input.pluginId) : null;
  const applicationId = typedId === "" ? (saved?.applicationId ?? "") : typedId;
  if (applicationId === "" || input.privateKey.trim() === "") throw new PluginActionError("missing");
  if (applicationId.length > MAX_ID_LENGTH || /\s/.test(applicationId)) {
    throw new PluginActionError("credentials_invalid");
  }
  if (input.privateKey.length > MAX_KEY_LENGTH || !looksLikePrivateKey(input.privateKey)) {
    throw new PluginActionError("key_format");
  }
  const credentials = { applicationId, privateKey: normalizePrivateKey(input.privateKey) };

  let access: "read-only" | "write" | "unverifiable";
  try {
    ({ access } = await callPlugin(plugin.config, PLUGIN_PATHS.verify, verifyResponseSchema, {
      body: { credentials },
      fetchFn: deps.fetchFn,
    }));
  } catch (error) {
    if (!(error instanceof PluginCallError)) throw error;
    if (error.code === "key_format") throw new PluginActionError("key_format");
    if (error.code === "auth") throw new PluginActionError("credentials_invalid");
    if (error.code === "plugin_down") throw new PluginActionError("plugin_down");
    if (error.code === "provider_down" || error.code === "rate_limited")
      throw new PluginActionError("unreachable");
    throw new PluginActionError("failed");
  }
  if (access === "write") throw new PluginActionError("write_not_allowed");

  const sealed = sealJson(keyRing(), credentials);
  await getDb()
    .insert(pluginUserCredentials)
    .values(userScoped(ctx).stamp({ pluginId: input.pluginId, credentials: sealed, savedAt: now }))
    .onConflictDoUpdate({
      target: [pluginUserCredentials.userId, pluginUserCredentials.pluginId],
      set: { credentials: sealed, savedAt: now, invalidAt: null, updatedAt: now },
    });
  // The key the provider refused is replaced: the banks it opens no longer ask for one.
  await clearErrorCode(ctx, pluginProvider(input.pluginId), "auth");
}

/** Deletes a person's credentials. Only with no bank connected: a connection needs them (§4.3). */
export async function removeUserCredentials(ctx: Pick<Ctx, "userId">, pluginId: string): Promise<void> {
  await requireActivePlugin(ctx, pluginId);
  if ((await listPluginConnections(ctx, pluginId)).length > 0) throw new PluginActionError("connected");
  await getDb()
    .delete(pluginUserCredentials)
    .where(and(userScoped(ctx).owns(pluginUserCredentials), eq(pluginUserCredentials.pluginId, pluginId)));
}

/* Calls made with a person's credentials */

/** A failed call as an action names it; a refused key is also recorded on the credentials. */
async function actionFailure(
  ctx: Pick<Ctx, "userId">,
  pluginId: string,
  error: unknown,
  now: Date,
): Promise<PluginActionError> {
  if (!(error instanceof PluginCallError)) throw error;
  if (error.code === "auth") {
    await markCredentialsInvalid(ctx, pluginId, now);
    return new PluginActionError("auth");
  }
  if (error.code === "institution_unavailable") return new PluginActionError("bank_unavailable");
  if (error.code === "key_format" || error.code === "invalid_request") return new PluginActionError("failed");
  return new PluginActionError(error.code);
}

/** The banks of a country, for the step "choose your bank" (§6.2). */
export async function listInstitutions(
  ctx: Pick<Ctx, "userId">,
  input: { pluginId: string; country: string },
  now: Date = new Date(),
  deps: Deps = {},
): Promise<InstitutionsResponse["institutions"]> {
  const plugin = await requireActivePlugin(ctx, input.pluginId);
  const credentials = await requireUserCredentials(ctx, input.pluginId);
  try {
    const answer = await callPlugin(plugin.config, PLUGIN_PATHS.institutions, institutionsResponseSchema, {
      body: { credentials, country: input.country },
      fetchFn: deps.fetchFn,
    });
    return answer.institutions;
  } catch (error) {
    throw await actionFailure(ctx, input.pluginId, error, now);
  }
}

/* An access, from its start to its return */

/** Where the provider sends the browser back: the one return route, by plugin id (§6.3). */
export function returnAddress(pluginId: string): string {
  return `${readEnv().BETTER_AUTH_URL.replace(/\/+$/, "")}/api/v1/plugins/${pluginId}/callback`;
}

/**
 * Starts an access to a bank and returns the address of the bank's site. The `state` that comes
 * back with the person is random, kept only as a hash, tied to the session that asked and good
 * for a quarter of an hour: a return that does not match all of that is refused.
 */
export async function startAccess(
  ctx: Pick<Ctx, "userId">,
  input: { pluginId: string; sessionId: string; institution: { name: string; country: string } },
  now: Date = new Date(),
  deps: Deps = {},
): Promise<{ url: string }> {
  const plugin = await requireActivePlugin(ctx, input.pluginId);
  const credentials = await requireUserCredentials(ctx, input.pluginId);
  await deleteExpiredStates(now);
  const state = randomBytes(32).toString("base64url");
  let url: string;
  try {
    ({ url } = await callPlugin(plugin.config, PLUGIN_PATHS.authStart, authStartResponseSchema, {
      body: {
        credentials,
        institution: input.institution,
        state,
        redirectUrl: returnAddress(input.pluginId),
      },
      fetchFn: deps.fetchFn,
    }));
  } catch (error) {
    throw await actionFailure(ctx, input.pluginId, error, now);
  }
  await getDb()
    .insert(pluginAuthStates)
    .values(
      userScoped(ctx).stamp({
        pluginId: input.pluginId,
        stateHash: hashState(state),
        sessionId: input.sessionId,
        payload: { name: input.institution.name, country: input.institution.country },
        expiresAt: new Date(now.getTime() + AUTH_STATE_MINUTES * 60_000),
      }),
    );
  return { url };
}

/**
 * What a return ended with: the bank's connection, or why there is none (§6.3). `renewed`: the
 * bank was already connected and its accounts chosen, so this access replaced the one before.
 */
export type ReturnOutcome =
  | { ok: true; connectionId: string; renewed: boolean }
  | { ok: false; error: ReturnError; bank: string | null };

/** The person's address and browser, when they are the one asking (04-now.md §4.2, `Psu-*`). */
export interface Presence {
  ip: string | null;
  userAgent: string | null;
}

/** What the provider put on the return address. */
interface ReturnQuery {
  state: string | null;
  code: string | null;
  error: string | null;
}

/**
 * The provider's word for a failed return (`access_denied`), for the log: kept only when it has the
 * shape of an error name, so a text somebody typed into the address never reaches a log.
 */
function errorWord(value: string): string {
  return /^[a-z_]{3,40}$/.test(value) ? value : "an error";
}

/**
 * Takes the pending access `state` names, once. `null` when there is none for this person and
 * this session — a state nobody started, somebody else's, one already used.
 */
async function consumeState(
  ctx: Pick<Ctx, "userId">,
  input: { pluginId: string; sessionId: string; state: string },
  now: Date,
): Promise<{ payload: Record<string, string>; expired: boolean } | null> {
  const [row] = await getDb()
    .update(pluginAuthStates)
    .set({ consumedAt: now })
    .where(
      and(
        userScoped(ctx).owns(pluginAuthStates),
        eq(pluginAuthStates.pluginId, input.pluginId),
        eq(pluginAuthStates.stateHash, hashState(input.state)),
        eq(pluginAuthStates.sessionId, input.sessionId),
        isNull(pluginAuthStates.consumedAt),
      ),
    )
    .returning({ payload: pluginAuthStates.payload, expiresAt: pluginAuthStates.expiresAt });
  return row ? { payload: row.payload, expired: row.expiresAt.getTime() <= now.getTime() } : null;
}

const accountsSchema = z.array(accountSchema);

/** What a bank's connection seals: the access, and the accounts the bank exposed with it. */
export function connectionBag(
  sessionId: string,
  accounts: readonly PluginAccount[],
  choice: { chosen: boolean; skipped: readonly string[] },
): Record<string, string> {
  return {
    sessionId,
    accounts: JSON.stringify(accounts),
    ...(choice.chosen ? { chosen: "1" } : {}),
    ...(choice.skipped.length > 0 ? { skipped: JSON.stringify(choice.skipped) } : {}),
  };
}

function parsedJson(text: string | undefined): unknown {
  try {
    return JSON.parse(text ?? "[]");
  } catch {
    return [];
  }
}

/**
 * `chosen`: the person has chosen what each account is here; before that the connection is "to
 * complete". `skipped`: the accounts they chose not to import, so a renewed access does not ask
 * about them again.
 */
export function readBag(bag: Record<string, string>): {
  sessionId: string;
  accounts: PluginAccount[];
  chosen: boolean;
  skipped: string[];
} {
  const accounts = accountsSchema.safeParse(parsedJson(bag.accounts));
  const skipped = z.array(z.string()).safeParse(parsedJson(bag.skipped));
  return {
    sessionId: bag.sessionId ?? "",
    accounts: accounts.success ? accounts.data : [],
    chosen: bag.chosen === "1",
    skipped: skipped.success ? skipped.data : [],
  };
}

/** Closes an access at the provider, without a word if that fails: it ends by itself anyway. */
async function revokeQuietly(
  plugin: InstancePlugin,
  credentials: Record<string, string>,
  sessionId: string,
  deps: Deps,
): Promise<void> {
  try {
    await callPlugin(plugin.config, PLUGIN_PATHS.authRevoke, authRevokeResponseSchema, {
      body: { credentials, session: { id: sessionId } },
      fetchFn: deps.fetchFn,
    });
  } catch (error) {
    if (!(error instanceof PluginCallError)) throw error;
  }
}

/**
 * The return from the bank's site (§6.3): checks the `state` against the person and the session,
 * exchanges the `code` for the access, seals it as the bank's connection and reads the bank at
 * once — the history older than 90 days is only there in the first minutes (§4.2).
 *
 * Step 1 of N1 (the trial on a real bank): the first reading is measured and nothing of it is
 * written. Choosing the accounts and importing the movements join with the rest of N1.
 */
export async function completeAccess(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  input: { pluginId: string; sessionId: string; query: ReturnQuery; presence: Presence | null },
  now: Date = new Date(),
  deps: Deps = {},
): Promise<ReturnOutcome> {
  // Why a return ended with no connection, for whoever reads the log: the code the person sees
  // and the step that gave it. Codes only — never a name, a state, a code of the provider's.
  const refused = (error: ReturnError, bank: string | null, step: string): ReturnOutcome => {
    console.warn(`[plugins] return of ${input.pluginId} refused: ${error} (${step})`);
    return { ok: false, error, bank };
  };
  let plugin: InstancePlugin;
  try {
    plugin = await requireActivePlugin(ctx, input.pluginId);
  } catch (error) {
    if (error instanceof PluginActionError) return refused("session", null, `plugin ${error.code}`);
    throw error;
  }
  if (input.query.state === null) return refused("session", null, "no state");
  const pending = await consumeState(
    ctx,
    { pluginId: input.pluginId, sessionId: input.sessionId, state: input.query.state },
    now,
  );
  if (pending === null) return refused("session", null, "state not pending for this session");
  const bank = pending.payload.name ?? null;
  if (pending.expired) return refused("expired", bank, "state past its time");
  if (input.query.error !== null)
    return refused("denied", bank, `provider said ${errorWord(input.query.error)}`);
  if (input.query.code === null) return refused("denied", bank, "no code");

  const credentials = await readUserCredentials(ctx, input.pluginId);
  if (credentials === null) return refused("session", bank, "no credentials");

  let access;
  try {
    access = await callPlugin(plugin.config, PLUGIN_PATHS.authComplete, authCompleteResponseSchema, {
      body: { credentials, code: input.query.code },
      fetchFn: deps.fetchFn,
    });
  } catch (error) {
    if (!(error instanceof PluginCallError)) throw error;
    if (error.code === "auth") await markCredentialsInvalid(ctx, input.pluginId, now);
    const step = `exchange failed with ${error.code}`;
    if (error.code === "consent_expired") return refused("expired", bank, step);
    if (error.code === "institution_unavailable") return refused("bank_unavailable", bank, step);
    // The bank answered, and the answer could not be read: a different sentence from "no answer".
    return refused(error.code === "invalid_data" ? "unreadable" : "unreachable", bank, step);
  }
  if (access.accounts.length === 0) {
    await revokeQuietly(plugin, credentials, access.session.id, deps);
    return refused("no_accounts", bank, "no readable account in the access");
  }

  // The same bank again is a renewal: what the person chose for its accounts stays (§6.7).
  const key = instanceKeyOf(access.institution);
  const previous = (await listPluginConnections(ctx, input.pluginId)).find((one) => one.instanceKey === key);
  const before = previous ? readBag(await readCredentials(ctx, previous.id)) : null;
  // The accounts of this bank left out or deleted here before, also when it was disconnected.
  const exposed = new Set(access.accounts.map(providerAccountIdOf));
  const remembered = [...(await sourceSkippedIds(ctx, pluginProvider(input.pluginId)))].filter((id) =>
    exposed.has(id),
  );
  let connection: Connection;
  try {
    connection = await savePluginConnection(
      ctx,
      {
        provider: pluginProvider(input.pluginId),
        instanceKey: key,
        credentials: connectionBag(access.session.id, access.accounts, {
          chosen: before?.chosen ?? false,
          skipped: [...new Set([...(before?.skipped ?? []), ...remembered])],
        }),
        expiresAt: access.session.expiresAt === null ? null : new Date(access.session.expiresAt),
      },
      now,
    );
  } catch (error) {
    if (!(error instanceof IntegrationError)) throw error;
    await revokeQuietly(plugin, credentials, access.session.id, deps);
    return refused("unreachable", bank, `connection not saved: ${error.code}`);
  }
  // The access before is closed only now that the new one is saved.
  if (before && before.sessionId !== "" && before.sessionId !== access.session.id) {
    await revokeQuietly(plugin, credentials, before.sessionId, deps);
  }
  return { ok: true, connectionId: connection.id, renewed: before?.chosen === true };
}

/** What a page may know of a bank's connection: no access, no account number in full. */
interface ConnectionSummary {
  /** The accounts the bank exposes with this access. */
  accounts: number;
  /** Whether the person has chosen what each account is here. */
  chosen: boolean;
  /** The accounts the person left out. */
  skipped: number;
  /** The bank's ids of the accounts the access exposes. */
  accountIds: string[];
}

export async function connectionSummary(
  ctx: Pick<Ctx, "userId">,
  connectionId: string,
): Promise<ConnectionSummary> {
  const bag = readBag(await readCredentials(ctx, connectionId));
  return {
    accounts: bag.accounts.length,
    chosen: bag.chosen,
    skipped: bag.skipped.length,
    accountIds: bag.accounts.map(providerAccountIdOf),
  };
}

/**
 * The connection of a plugin whose access shares one account, by the provider's own id of the
 * account: which bank an account of the person comes from. `null` when no access shares it.
 */
export async function connectionSharing(
  ctx: Pick<Ctx, "userId">,
  pluginId: string,
  providerAccountId: string,
): Promise<{ connection: Connection; chosen: boolean } | null> {
  for (const connection of await listPluginConnections(ctx, pluginId)) {
    const bag = readBag(await readCredentials(ctx, connection.id));
    if (bag.accounts.some((account) => providerAccountIdOf(account) === providerAccountId)) {
      return { connection, chosen: bag.chosen };
    }
  }
  return null;
}

/**
 * Disconnects a bank (§5.4): closes the access at the provider and forgets it here. Its accounts
 * stay tied to the bank's ids of them, "disconnected": nothing reads them, their balances and
 * movements stay, and a new access to the same bank ties them again by itself (`tieBack`). The
 * access is forgotten even when the provider does not answer: a person who disconnects must end
 * up disconnected.
 */
export async function disconnectBank(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  input: { pluginId: string; connectionId: string },
  deps: Deps = {},
): Promise<void> {
  const plugin = await requireActivePlugin(ctx, input.pluginId);
  const connection = (await listPluginConnections(ctx, input.pluginId)).find(
    (one) => one.id === input.connectionId,
  );
  if (!connection) throw new PluginActionError("not_found");
  const credentials = await readUserCredentials(ctx, input.pluginId);
  const { sessionId, skipped } = readBag(await readCredentials(ctx, connection.id));
  if (credentials !== null && sessionId !== "") await revokeQuietly(plugin, credentials, sessionId, deps);
  // The accounts left out stay left out when the same bank is connected again (H55, point 4).
  await changeSourceSkippedIds(ctx, connection.provider, { add: skipped });
  await deleteConnection(ctx, connection.id);
}

/* "Turn off" a plugin (plugin-settings.md §3, decision H55) */

/**
 * The closing of every bank access of the person, read now and run later (§3.2, step 3): the
 * credentials and the accesses are read before the conversion deletes them, and closed after it,
 * when nothing can undo the conversion any more. A provider that does not answer is not waited
 * for: an access ends by itself. Nothing to close for a plugin the instance no longer has.
 */
export async function prepareAccessClosing(
  ctx: Pick<Ctx, "userId">,
  pluginId: string,
  deps: Deps = {},
): Promise<() => Promise<void>> {
  const plugin = await findInstancePlugin(pluginId);
  const credentials = await readUserCredentials(ctx, pluginId);
  if (plugin === null || credentials === null) return async () => {};
  const sessions: string[] = [];
  for (const connection of await listPluginConnections(ctx, pluginId)) {
    const { sessionId } = readBag(await readCredentials(ctx, connection.id));
    if (sessionId !== "") sessions.push(sessionId);
  }
  return async () => {
    for (const sessionId of sessions) await revokeQuietly(plugin, credentials, sessionId, deps);
  };
}

/**
 * The plugin's own part of "Turn off", inside the caller's transaction: the person's credentials
 * and pending accesses go, and the plugin is off. Turning it on again starts from an empty page:
 * the person enters the credentials again (Q1). The connections are the platform's to delete.
 */
export async function forgetPlugin(
  tx: Tx,
  ctx: Pick<Ctx, "userId">,
  pluginId: string,
  now: Date = new Date(),
): Promise<void> {
  await tx
    .delete(pluginUserCredentials)
    .where(and(userScoped(ctx).owns(pluginUserCredentials), eq(pluginUserCredentials.pluginId, pluginId)));
  await tx
    .delete(pluginAuthStates)
    .where(and(userScoped(ctx).owns(pluginAuthStates), eq(pluginAuthStates.pluginId, pluginId)));
  const off = { active: false, deactivatedAt: now };
  await tx
    .insert(pluginActivations)
    .values(userScoped(ctx).stamp({ pluginId, ...off }))
    .onConflictDoUpdate({
      target: [pluginActivations.userId, pluginActivations.pluginId],
      set: { ...off, updatedAt: now },
    });
}

/** Drops the pending accesses nobody came back for. Called when one is started: no job of its own. */
async function deleteExpiredStates(now: Date): Promise<void> {
  await getDb()
    .delete(pluginAuthStates)
    .where(lt(pluginAuthStates.expiresAt, new Date(now.getTime() - 86_400_000)));
}
