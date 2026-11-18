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
import { pluginProvider } from "../integrations/rules";
import { type Connection, listConnections } from "../integrations/service";
import { type ConfiguredPlugin, parsePluginConfig } from "../plugin-config";
import { acceptsContract, type PluginManifest } from "@ledgerly/plugin-contract";
import { type UserPluginState, userPluginState } from "./rules";
import { pluginActivations, plugins, pluginUserCredentials } from "./schema";

let configured: ConfiguredPlugin[] | undefined;

/** The plugins of the server's configuration, parsed once. */
export function configuredPlugins(): ConfiguredPlugin[] {
  const env = readEnv();
  configured ??= parsePluginConfig(env.PLUGIN_URLS, env.PLUGIN_SECRETS);
  return configured;
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

/** What the diagnostics of the server say about one plugin (ux/n2-connection-status.md §9). */
export interface PluginDiagnostic {
  id: string;
  /** The plugin's own name, or its id while its manifest was never read. */
  name: string;
  version: string | null;
  contract: string | null;
  state: "up" | "down" | "never" | "incompatible";
  /** The last good check (`up`) or the first failed one of the current series (`down`). */
  at: Date | null;
}

/**
 * The plugins of the server's configuration and whether each one answers. Nothing of any person:
 * no connection, no reading, no error of a connection (decision H29).
 */
export async function pluginDiagnostics(locale: "en" | "it"): Promise<PluginDiagnostic[]> {
  const known = configuredPlugins();
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
    if (!row)
      return { id: plugin.id, name: plugin.id, version: null, contract: null, state: "never", at: null };
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

/** The connections one person has through one plugin: one per bank. */
export async function listPluginConnections(
  ctx: Pick<Ctx, "userId">,
  pluginId: string,
): Promise<Connection[]> {
  const provider = pluginProvider(pluginId);
  return (await listConnections(ctx)).filter((connection) => connection.provider === provider);
}

/** A plugin as one person sees it in Settings › Integrations (§2.2). */
export interface UserPlugin {
  id: string;
  name: string;
  description: string;
  state: UserPluginState;
  /** When the person last turned it off; shown only for `paused`. */
  pausedSince: Date | null;
  hasCredentials: boolean;
  connections: number;
}

/**
 * Every plugin of the instance with what it is for this person. The state is the person's own:
 * another person's activation, credentials and connections are not in any of these queries.
 */
export async function listUserPlugins(ctx: Pick<Ctx, "userId" | "locale">): Promise<UserPlugin[]> {
  const instance = await listInstancePlugins();
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
    };
  });
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
export interface CredentialsStatus {
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
