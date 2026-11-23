// src/app/(app)/banks/provider-name.ts — the name a screen shows for the provider of an account.
// A plugin's provider is stored as `plugin:<id>`: a person reads the provider's own name, from
// the manifest and in their language (rewrite plan, rule M14), never the id.
import "server-only";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { isPluginProvider } from "@ledgerly/domain/platform/integrations";
import { findInstancePlugin } from "@ledgerly/domain/platform/plugins";
import { sourceNameOf } from "@/platform/integrations/registry";

export async function providerName(
  ctx: Pick<Ctx, "locale">,
  provider: string | null,
): Promise<string | null> {
  if (provider === null || !isPluginProvider(provider)) return provider;
  const plugin = await findInstancePlugin(provider.slice("plugin:".length));
  // A plugin still read by an engine of the core (until R5c P3b) has its name there.
  return plugin?.manifest.labels.name[ctx.locale] ?? (await sourceNameOf(provider, ctx.locale));
}
