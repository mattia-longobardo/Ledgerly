// The card of a plugin's connection, chosen by the capabilities of its manifest (rewrite plan R5c,
// P3b): a source read with a token or a leave calendar. Any other plugin (a bank) has no card here.
import { pluginManifest } from "@ledgerly/domain/platform/plugins";
import { isPluginProvider } from "@ledgerly/domain/platform/integrations";
import { providerCan } from "./capabilities";
import type { PluginCard } from "./card";
import { BACKFILL_CHOICES, backfillDepth } from "./movements/depth";
import { calendarCard } from "./leave/card";
import { sourceCard } from "./movements/card";

/** The card of `provider`; `null` for a bank's plugin, an investment service or nobody. */
export async function cardOf(provider: string): Promise<PluginCard | null> {
  if (!isPluginProvider(provider)) return null;
  const manifest = await pluginManifest(provider.slice("plugin:".length));
  if (!manifest) return null;
  if (manifest.capabilities.includes("source.read")) return sourceCard(provider, manifest);
  if (manifest.capabilities.includes("leaveCalendar")) return calendarCard(provider, manifest);
  return null;
}

/**
 * For a source whose first reading goes back a chosen number of months: the choices, and the depth a
 * cursor of the movements asks for. "Advanced" offers to read that far again. `null` for any other.
 */
export async function historyOf(provider: string): Promise<{
  choices: readonly number[];
  depthOf: (cursor: Record<string, string> | null | undefined) => number;
} | null> {
  if (!(await providerCan(provider, "source.read"))) return null;
  return { choices: BACKFILL_CHOICES, depthOf: backfillDepth };
}
