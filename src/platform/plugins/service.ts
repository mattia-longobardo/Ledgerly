/**
 * The core's side of a plugin (rewrite plan, 04-now.md §4.1 and §4.2): reading the manifest,
 * turning a plugin on for one person, sealing that person's credentials, and taking an access to
 * a provider from its start to the connection it leaves.
 *
 * Every function is `(ctx, input)` and none imports Next.js: the Server Actions and the return
 * route are thin wrappers around these. No call to a plugin happens inside a database
 * transaction, and no error carries what a plugin or a provider said: only a code.
 */
import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import type { Ctx } from "@/platform/context";
import { type KeyRing, openJson, parseKeyRing, sealJson } from "@/platform/crypto";
import { civilDateIn } from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import { readEnv } from "@/platform/env";
import { pluginProvider } from "@/platform/integrations/rules";
import {
  type Connection,
  deleteConnection,
  finishRun,
  IntegrationError,
  readCredentials,
  recordRun,
  savePluginConnection,
} from "@/platform/integrations/service";
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
  type SyncResponse,
  syncResponseSchema,
  verifyResponseSchema,
} from "./contract/calls";
import { acceptsContract, manifestSchema } from "./contract/manifest";
import {
  configuredPlugins,
  findInstancePlugin,
  type InstancePlugin,
  isPluginActive,
  listPluginConnections,
} from "./queries";
import {
  AUTH_STATE_MINUTES,
  hashState,
  instanceKeyOf,
  looksLikePrivateKey,
  measureReading,
  normalizePrivateKey,
  type ReturnError,
} from "./rules";
import { pluginActivations, pluginAuthStates, plugins, pluginUserCredentials } from "./schema";

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
  | "one_bank"
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

let ring: KeyRing | undefined;

function keyRing(): KeyRing {
  ring ??= parseKeyRing(readEnv().APP_ENCRYPTION_KEY);
  return ring;
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
      // A plugin answers for its own id only, and only in a contract this core speaks.
      if (manifest.id !== plugin.id || !acceptsContract(manifest.contract)) continue;
      const values = {
        url: plugin.url,
        manifest,
        contract: manifest.contract,
        state: "ready",
        manifestReadAt: now,
      };
      await getDb()
        .insert(plugins)
        .values({ id: plugin.id, ...values })
        .onConflictDoUpdate({ target: plugins.id, set: { ...values, updatedAt: now } });
    } catch (error) {
      if (!(error instanceof PluginCallError)) throw error;
      if (row) await getDb().update(plugins).set({ state: "unreachable" }).where(eq(plugins.id, plugin.id));
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
  if (!plugin) throw new PluginActionError("not_found");
  return plugin;
}

/** The plugin, for an action only a person who has turned it on may take (H25). */
async function requireActivePlugin(ctx: Pick<Ctx, "userId">, pluginId: string): Promise<InstancePlugin> {
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

async function requireUserCredentials(
  ctx: Pick<Ctx, "userId">,
  pluginId: string,
): Promise<Record<string, string>> {
  const credentials = await readUserCredentials(ctx, pluginId);
  if (credentials === null) throw new PluginActionError("missing");
  return credentials;
}

/** Records that the provider refuses this person's credentials, so the screens can say so (§4.4). */
async function markCredentialsInvalid(ctx: Pick<Ctx, "userId">, pluginId: string, now: Date): Promise<void> {
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
 *
 * Until N2 a person connects one bank: a second one is refused here, before the provider is asked.
 */
export async function startAccess(
  ctx: Pick<Ctx, "userId">,
  input: { pluginId: string; sessionId: string; institution: { name: string; country: string } },
  now: Date = new Date(),
  deps: Deps = {},
): Promise<{ url: string }> {
  const plugin = await requireActivePlugin(ctx, input.pluginId);
  const credentials = await requireUserCredentials(ctx, input.pluginId);
  const key = instanceKeyOf(input.institution);
  const others = (await listPluginConnections(ctx, input.pluginId)).filter((one) => one.instanceKey !== key);
  if (others.length > 0) throw new PluginActionError("one_bank");

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

/** What a return ended with: a connection read for the first time, or why there is none (§6.3). */
export type ReturnOutcome =
  { ok: true; connectionId: string } | { ok: false; error: ReturnError; bank: string | null };

/** The person's address and browser, when they are the one asking (04-now.md §4.2, `Psu-*`). */
export interface Presence {
  ip: string | null;
  userAgent: string | null;
}

/** What the provider put on the return address. */
export interface ReturnQuery {
  state: string | null;
  code: string | null;
  error: string | null;
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
function connectionBag(sessionId: string, accounts: readonly PluginAccount[]): Record<string, string> {
  return { sessionId, accounts: JSON.stringify(accounts) };
}

function readBag(bag: Record<string, string>): { sessionId: string; accounts: PluginAccount[] } {
  let accounts: unknown;
  try {
    accounts = JSON.parse(bag.accounts ?? "[]");
  } catch {
    accounts = [];
  }
  const parsed = accountsSchema.safeParse(accounts);
  return { sessionId: bag.sessionId ?? "", accounts: parsed.success ? parsed.data : [] };
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
  const refused = (error: ReturnError, bank: string | null = null): ReturnOutcome => ({
    ok: false,
    error,
    bank,
  });
  let plugin: InstancePlugin;
  try {
    plugin = await requireActivePlugin(ctx, input.pluginId);
  } catch (error) {
    if (error instanceof PluginActionError) return refused("session");
    throw error;
  }
  if (input.query.state === null) return refused("session");
  const pending = await consumeState(
    ctx,
    { pluginId: input.pluginId, sessionId: input.sessionId, state: input.query.state },
    now,
  );
  if (pending === null) return refused("session");
  const bank = pending.payload.name ?? null;
  if (pending.expired) return refused("expired", bank);
  if (input.query.error !== null || input.query.code === null) return refused("denied", bank);

  const credentials = await readUserCredentials(ctx, input.pluginId);
  if (credentials === null) return refused("session", bank);

  let access;
  try {
    access = await callPlugin(plugin.config, PLUGIN_PATHS.authComplete, authCompleteResponseSchema, {
      body: { credentials, code: input.query.code },
      fetchFn: deps.fetchFn,
    });
  } catch (error) {
    if (!(error instanceof PluginCallError)) throw error;
    if (error.code === "auth") await markCredentialsInvalid(ctx, input.pluginId, now);
    if (error.code === "consent_expired") return refused("expired", bank);
    return refused(error.code === "institution_unavailable" ? "bank_unavailable" : "unreachable", bank);
  }
  if (access.accounts.length === 0) {
    await revokeQuietly(plugin, credentials, access.session.id, deps);
    return refused("no_accounts", bank);
  }

  let connection: Connection;
  try {
    connection = await savePluginConnection(
      ctx,
      {
        provider: pluginProvider(input.pluginId),
        instanceKey: instanceKeyOf(access.institution),
        credentials: connectionBag(access.session.id, access.accounts),
        expiresAt: access.session.expiresAt === null ? null : new Date(access.session.expiresAt),
      },
      now,
    );
  } catch (error) {
    if (!(error instanceof IntegrationError)) throw error;
    await revokeQuietly(plugin, credentials, access.session.id, deps);
    return refused("unreachable", bank);
  }
  await measureFirstReading(ctx, { plugin, connection, credentials, presence: input.presence }, now, deps);
  return { ok: true, connectionId: connection.id };
}

/* Reading a bank */

const SYNC_TIMEOUT_MS = 60_000;
/** The calls one reading makes at most: a reading that does not end is cut, not left running. */
const MAX_SYNC_CALLS = 12;
/**
 * After this long the first reading starts no new call: it runs inside the person's return from
 * the bank, and a browser — or a proxy in front of the app — does not wait for ever.
 */
const FIRST_READING_BUDGET_MS = 30_000;

/**
 * Step 1 of N1: reads everything the bank gives right after the access and records what it found
 * as numbers on a sync run (`measureReading`). Nothing of the reading itself is stored.
 */
async function measureFirstReading(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  input: {
    plugin: InstancePlugin;
    connection: Connection;
    credentials: Record<string, string>;
    presence: Presence | null;
  },
  now: Date,
  deps: Deps,
): Promise<void> {
  const { sessionId, accounts } = readBag(await readCredentials(ctx, input.connection.id));
  const run = await recordRun(ctx, { connectionId: input.connection.id, kind: "accounts" });
  const batches: SyncResponse[] = [];
  let failure: string | undefined;
  let cursor: string | null = null;
  const started = Date.now();
  try {
    do {
      const batch: SyncResponse = await callPlugin(
        input.plugin.config,
        PLUGIN_PATHS.sync,
        syncResponseSchema,
        {
          body: {
            credentials: input.credentials,
            session: { id: sessionId },
            accounts: accounts.map((account) => account.externalId),
            from: null,
            cursor,
            // The person is here: this reading starts from their own return from the bank.
            userPresent: input.presence,
          },
          timeoutMs: SYNC_TIMEOUT_MS,
          fetchFn: deps.fetchFn,
        },
      );
      batches.push(batch);
      cursor = batch.cursor;
    } while (
      cursor !== null &&
      batches.length < MAX_SYNC_CALLS &&
      Date.now() - started < FIRST_READING_BUDGET_MS
    );
  } catch (error) {
    if (!(error instanceof PluginCallError)) throw error;
    if (error.code === "auth") await markCredentialsInvalid(ctx, input.plugin.config.id, now);
    failure = error.code;
  }
  const today = civilDateIn(now, ctx.timeZone);
  // `incomplete`: the reading was cut before the plugin had given everything.
  const counts = { ...measureReading(accounts, batches, today), incomplete: cursor === null ? 0 : 1 };
  await finishRun(ctx, run.id, { counts, error: failure }, now);
}

/** What a page may know of a bank's connection: no access, no account number in full. */
export interface ConnectionSummary {
  accounts: number;
}

export async function connectionSummary(
  ctx: Pick<Ctx, "userId">,
  connectionId: string,
): Promise<ConnectionSummary> {
  return { accounts: readBag(await readCredentials(ctx, connectionId)).accounts.length };
}

/**
 * Disconnects a bank (§5.4): closes the access at the provider, then forgets it here. The second
 * happens even when the first fails — a person who disconnects must end up disconnected.
 */
export async function disconnectBank(
  ctx: Pick<Ctx, "userId">,
  input: { pluginId: string; connectionId: string },
  deps: Deps = {},
): Promise<void> {
  const plugin = await requireActivePlugin(ctx, input.pluginId);
  const connection = (await listPluginConnections(ctx, input.pluginId)).find(
    (one) => one.id === input.connectionId,
  );
  if (!connection) throw new PluginActionError("not_found");
  const credentials = await readUserCredentials(ctx, input.pluginId);
  const { sessionId } = readBag(await readCredentials(ctx, connection.id));
  if (credentials !== null && sessionId !== "") await revokeQuietly(plugin, credentials, sessionId, deps);
  await deleteConnection(ctx, connection.id);
}

/** Drops the pending accesses nobody came back for. Called when one is started: no job of its own. */
async function deleteExpiredStates(now: Date): Promise<void> {
  await getDb()
    .delete(pluginAuthStates)
    .where(lt(pluginAuthStates.expiresAt, new Date(now.getTime() - 86_400_000)));
}
