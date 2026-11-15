// src/app/(app)/banks/provider-name.ts — the name a screen shows for the provider of an account.
// A plugin's provider is stored as `plugin:<id>`: a person reads the provider's own name, from
// the manifest and in their language (rewrite plan, rule M14), never the id.
import "server-only";
import type { Ctx } from "@/platform/context";
import { isPluginProvider } from "@/platform/integrations/rules";
import { findInstancePlugin } from "@/platform/plugins/queries";

export async function providerName(
  ctx: Pick<Ctx, "locale">,
  provider: string | null,
): Promise<string | null> {
  if (provider === null || !isPluginProvider(provider)) return provider;
  const plugin = await findInstancePlugin(provider.slice("plugin:".length));
  return plugin?.manifest.labels.name[ctx.locale] ?? provider;
}
