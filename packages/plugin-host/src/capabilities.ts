/**
 * What a plugin's connection can do, from the capabilities of the plugin's manifest (rewrite plan
 * R5c, P3b; mechanism E5): the engines of a source and of a leave calendar choose their connections
 * and their behaviour this way, never by a provider's name (rule M12).
 */
import { hasCapability } from "@ledgerly/plugin-contract";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { type Connection, isPluginProvider, listConnections } from "@ledgerly/domain/platform/integrations";
import { pluginManifest } from "@ledgerly/domain/platform/plugins";

/** The capabilities the engines of the core read; the vocabulary of the manifest is wider. */
type EngineCapability =
  | "source.read"
  | "createRecord"
  | "editRecord"
  | "categories"
  | "deleteCategory"
  | "leaveCalendar"
  | "provider.write";

/** Whether the plugin of `provider` (`plugin:<id>`) declares `capability`; never for another provider. */
export async function providerCan(provider: string, capability: EngineCapability): Promise<boolean> {
  if (!isPluginProvider(provider)) return false;
  const manifest = await pluginManifest(provider.slice("plugin:".length));
  return manifest !== null && hasCapability(manifest, capability);
}

/** The person's connections whose plugin declares `capability`, in the order they were made. */
export async function connectionsThatCan(
  ctx: Pick<Ctx, "userId">,
  capability: EngineCapability,
): Promise<Connection[]> {
  const found: Connection[] = [];
  for (const connection of await listConnections(ctx)) {
    if (await providerCan(connection.provider, capability)) found.push(connection);
  }
  return found;
}

/**
 * The name of the provider of a plugin's connection as a run's error writes it (`sync_runs.error`
 * holds the provider's diagnostics in English): the manifest's, or the plugin's id until it is read.
 */
export async function providerName(provider: string): Promise<string> {
  const pluginId = provider.slice("plugin:".length);
  return (await pluginManifest(pluginId))?.labels.name.en ?? pluginId;
}
