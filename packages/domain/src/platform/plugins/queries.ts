/**
 * What the screens read about plugins (ux/n1-plugin-bank.md §2, §3.1). Nothing here returns a
 * credential, a key or a session of a provider: a page that reads only from this file has nothing
 * secret to send to a browser.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Ctx } from "../context";
import { getDb } from "../db/client";
import { userScoped } from "../db/scope";
import { readEnv } from "../env";
import { isBankPlugin, isPluginProvider, pluginProvider } from "../integrations/rules";
import { type Connection, listConnections } from "../integrations/service";
import { type ConfiguredPlugin, parsePluginConfig } from "../plugin-config";
import { acceptsContract, hasCapability, type PluginManifest } from "@ledgerly/plugin-contract";
import { type UserPluginState, userPluginState } from "./rules";
import { catalogEntry } from "./catalog";
import { pluginActivations, plugins, pluginUserCredentials } from "./schema";

let configured: ConfiguredPlugin[] | undefined;

/** Every plugin of the server's configuration, parsed once: official or not. */
function everyConfiguredPlugin(): ConfiguredPlugin[] {
  const env = readEnv();
  configured ??= parsePluginConfig(env.PLUGIN_URLS, env.PLUGIN_SECRETS);
  return configured;
}

/**
 * The plugins of the server's configuration that the core calls: the ones of the catalog (H27).
 * Any other is never called, not even for its manifest, and only the diagnostics name it.
 */
export function configuredPlugins(): ConfiguredPlugin[] {
  return everyConfiguredPlugin().filter((plugin) => catalogEntry(plugin.id) !== null);
}

export function configuredPlugin(pluginId: string): ConfiguredPlugin | null {
  return configuredPlugins().find((plugin) => plugin.id === pluginId) ?? null;
}

/** A plugin the instance has: configured, and with a manifest the core has read and accepts. */
export interface InstancePlugin {
  config: ConfiguredPlugin;
  manifest: PluginManifest;
  manifestReadAt: Date;
}

/** The plugins of the instance whose manifest has been read at least once (§2.1). */
export async function listInstancePlugins(): Promise<InstancePlugin[]> {
  const known = configuredPlugins();
  if (known.length === 0) return [];
  const rows = await getDb()
    .select({
      id: plugins.id,
      manifest: plugins.manifest,
      contract: plugins.contract,
      readAt: plugins.manifestReadAt,
    })
    .from(plugins)
    .where(
      inArray(
        plugins.id,
        known.map((plugin) => plugin.id),
      ),
    )
    .orderBy(asc(plugins.id));
  return rows.flatMap((row) => {
    const config = known.find((plugin) => plugin.id === row.id);
    return config && acceptsContract(row.contract)
      ? [{ config, manifest: row.manifest, manifestReadAt: row.readAt }]
      : [];
  });
}

/**
 * The plugin that prices the markets of the instance (R5d), the first one with `prices.daily`, or
 * null. It serves the instance, not a person: no one turns it on.
 */
export async function pricesPlugin(): Promise<InstancePlugin | null> {
  return (await listInstancePlugins()).find((one) => hasCapability(one.manifest, "prices.daily")) ?? null;
}

/** What the diagnostics of the server say about one plugin (ux/n2-connection-status.md §9). */
export interface PluginDiagnostic {
  id: string;
  /** The plugin's own name, or its id while its manifest was never read. */
  name: string;
  version: string | null;
  contract: string | null;
  /** `uncatalogued`: configured, not in the catalog of the official plugins, never called. */
  state: "up" | "down" | "never" | "incompatible" | "uncatalogued";
  /** The last good check (`up`) or the first failed one of the current series (`down`). */
  at: Date | null;
}

/**
 * The plugins of the server's configuration and whether each one answers. Nothing of any person:
 * no connection, no reading, no error of a connection (decision H29).
 */
export async function pluginDiagnostics(locale: "en" | "it"): Promise<PluginDiagnostic[]> {
  const known = everyConfiguredPlugin();
  if (known.length === 0) return [];
  const rows = await getDb()
    .select({
      id: plugins.id,
      manifest: plugins.manifest,
      contract: plugins.contract,
      state: plugins.state,
      readAt: plugins.manifestReadAt,
      unreachableSince: plugins.unreachableSince,
    })
    .from(plugins)
    .where(
      inArray(
        plugins.id,
        known.map((plugin) => plugin.id),
      ),
    )
    .orderBy(asc(plugins.id));
  return known.map((plugin) => {
    const row = rows.find((one) => one.id === plugin.id);
    const unread = { id: plugin.id, name: plugin.id, version: null, contract: null, at: null };
    if (catalogEntry(plugin.id) === null) return { ...unread, state: "uncatalogued" };
    if (!row) return { ...unread, state: "never" };
    const facts = {
      id: plugin.id,
      name: row.manifest.labels.name[locale],
      version: row.manifest.version,
      contract: row.contract,
    };
    if (!acceptsContract(row.contract)) return { ...facts, state: "incompatible", at: row.readAt };
    return row.state === "unreachable"
      ? { ...facts, state: "down", at: row.unreachableSince }
      : { ...facts, state: "up", at: row.readAt };
  });
}

export async function findInstancePlugin(pluginId: string): Promise<InstancePlugin | null> {
  return (await listInstancePlugins()).find((plugin) => plugin.config.id === pluginId) ?? null;
}

// On `globalThis`, as the ports: one process may load this file in more than one bundle.
declare global {
  var ledgerlyReadManifests: Map<string, PluginManifest> | undefined;
}

/**
 * Keeps a manifest this process has read (`refreshManifests` of plugin-host), or was handed (a
 * plugin served in-process by the tests): what {@link pluginManifest} answers while the database
 * has no row of the plugin yet.
 */
export function rememberManifest(manifest: PluginManifest): void {
  globalThis.ledgerlyReadManifests ??= new Map();
  globalThis.ledgerlyReadManifests.set(manifest.id, manifest);
}

/**
 * The manifest of a plugin (rewrite plan R5c, P3b): the one the database keeps, else the one this
 * process read last; `null` while it was never read. What a plugin can do — its kinds, its addon,
 * whether its accounts take the movements written here — is read from it, never from its id.
 */
export async function pluginManifest(pluginId: string): Promise<PluginManifest | null> {
  const plugin = await findInstancePlugin(pluginId);
  return plugin?.manifest ?? globalThis.ledgerlyReadManifests?.get(pluginId) ?? null;
}

/** The connections one person has through one plugin: one per bank. */
export async function listPluginConnections(
  ctx: Pick<Ctx, "userId">,
  pluginId: string,
): Promise<Connection[]> {
  const provider = pluginProvider(pluginId);
  return (await listConnections(ctx)).filter((connection) => connection.provider === provider);
}

/** A plugin as one person sees it in Settings › Integrations (§2.2). */
interface UserPlugin {
  id: string;
  name: string;
  description: string;
  state: UserPluginState;
  /** When the person last turned it off; shown only for `paused`. */
  pausedSince: Date | null;
  hasCredentials: boolean;
  connections: number;
  /** The ISO codes of the manifest's `country` connection field, in its order; empty without it. */
  countries: string[];
  /** What reads it (rewrite plan R5c): the plugins' bank pass, or an engine of a source or of a calendar. */
  kind: "bank" | "source" | "calendar";
  /** The credential of a connection, as the manifest's `userSettings` describe it, in the person's language. */
  fields: (Pick<PluginManifest["userSettings"][number], "name" | "type" | "required"> & {
    label: string;
    help: string | null;
  })[];
}

/** What reads a plugin, from its manifest's capabilities: never its id (rule M12). */
function kindOf(capabilities: readonly string[]): UserPlugin["kind"] {
  if (capabilities.includes("leaveCalendar")) return "calendar";
  return capabilities.includes("source.read") ? "source" : "bank";
}

/**
 * Every plugin of the instance with what it is for this person. The state is the person's own:
 * another person's activation, credentials and connections are not in any of these queries.
 */
export async function listUserPlugins(ctx: Pick<Ctx, "userId" | "locale">): Promise<UserPlugin[]> {
  // A plugin of the instance, as the prices one, is nobody's to turn on (R5d).
  const instance = (await listInstancePlugins()).filter(
    (one) => !hasCapability(one.manifest, "prices.daily"),
  );
  if (instance.length === 0) return [];
  const [activations, credentials, connections] = await Promise.all([
    getDb()
      .select({
        pluginId: pluginActivations.pluginId,
        active: pluginActivations.active,
        deactivatedAt: pluginActivations.deactivatedAt,
      })
      .from(pluginActivations)
      .where(userScoped(ctx).owns(pluginActivations))
      .orderBy(asc(pluginActivations.pluginId)),
    getDb()
      .select({ pluginId: pluginUserCredentials.pluginId })
      .from(pluginUserCredentials)
      .where(userScoped(ctx).owns(pluginUserCredentials))
      .orderBy(asc(pluginUserCredentials.pluginId)),
    listConnections(ctx),
  ]);
  return instance.map(({ config, manifest }) => {
    const activation = activations.find((row) => row.pluginId === config.id);
    const hasCredentials = credentials.some((row) => row.pluginId === config.id);
    const provider = pluginProvider(config.id);
    const count = connections.filter((connection) => connection.provider === provider).length;
    return {
      id: config.id,
      name: manifest.labels.name[ctx.locale],
      description: manifest.labels.description[ctx.locale],
      state: userPluginState({ active: activation?.active === true, hasCredentials, connections: count }),
      pausedSince: activation?.deactivatedAt ?? null,
      hasCredentials,
      connections: count,
      countries:
        manifest.connectionFields
          .find((field) => field.name === "country")
          ?.options?.map((option) => option.value) ?? [],
      kind: kindOf(manifest.capabilities),
      fields: manifest.userSettings.map((field) => ({
        name: field.name,
        type: field.type,
        required: field.required,
        label: field.label[ctx.locale],
        help: field.help?.[ctx.locale] ?? null,
      })),
    };
  });
}

/** Every plugin this person has ever turned on or off: whether it is on, and when it was last turned off. */
export async function pluginActivationsOf(
  ctx: Pick<Ctx, "userId">,
): Promise<Map<string, { active: boolean; deactivatedAt: Date | null }>> {
  const rows = await getDb()
    .select({
      pluginId: pluginActivations.pluginId,
      active: pluginActivations.active,
      deactivatedAt: pluginActivations.deactivatedAt,
    })
    .from(pluginActivations)
    .where(userScoped(ctx).owns(pluginActivations));
  return new Map(rows.map(({ pluginId, ...row }) => [pluginId, row]));
}

/** Whether this person has the plugin on. Every action of a plugin asks this first (H25). */
export async function isPluginActive(ctx: Pick<Ctx, "userId">, pluginId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ active: pluginActivations.active })
    .from(pluginActivations)
    .where(and(userScoped(ctx).owns(pluginActivations), eq(pluginActivations.pluginId, pluginId)));
  return row?.active === true;
}

/** What a page may know about a person's credentials: that they are saved, since when, and if refused. */
interface CredentialsStatus {
  saved: boolean;
  savedAt: Date | null;
  invalid: boolean;
}

export async function credentialsStatus(
  ctx: Pick<Ctx, "userId">,
  pluginId: string,
): Promise<CredentialsStatus> {
  const [row] = await getDb()
    .select({ savedAt: pluginUserCredentials.savedAt, invalidAt: pluginUserCredentials.invalidAt })
    .from(pluginUserCredentials)
    .where(and(userScoped(ctx).owns(pluginUserCredentials), eq(pluginUserCredentials.pluginId, pluginId)));
  return row
    ? { saved: true, savedAt: row.savedAt, invalid: row.invalidAt !== null }
    : { saved: false, savedAt: null, invalid: false };
}

/**
 * The capabilities of a connection's provider: its plugin's manifest's, none while it was never read;
 * `null` for a provider of the core, which has no manifest.
 */
export async function capabilitiesOf(provider: string): Promise<readonly string[] | null> {
  if (!isPluginProvider(provider)) return null;
  return (await pluginManifest(provider.slice("plugin:".length)))?.capabilities ?? [];
}

/**
 * Whether a connection's provider is a bank's plugin, read by the plugins' own pass: a plugin whose
 * manifest is neither a source read with a token nor a leave calendar. A plugin never read is taken
 * as a bank's: the plugins the engines of plugin-host read have their manifest read before any
 * connection of theirs is made.
 */
export async function isBankPluginProvider(provider: string): Promise<boolean> {
  const capabilities = await capabilitiesOf(provider);
  return capabilities !== null && isBankPlugin(capabilities);
}
