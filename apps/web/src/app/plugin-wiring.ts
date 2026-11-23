// src/app/plugin-wiring.ts — where the application joins the plugin runtime to the rest (rewrite
// plan, rule M8). Importing this file registers the pass the dispatcher makes for a plugin's
// connections: the registry of passes must not import the runtime, and the runtime must not
// import the modules, so the one place that knows both is here.
//
// Every entry that can start a pass imports it: the tick of the cron sidecar and "Run now".
import "server-only";
import { ENGINE_PASSES, registerPass, type ProviderPass } from "@/platform/integrations/registry";
import { addonOf, findConnection, PLUGIN_KINDS } from "@ledgerly/domain/platform/integrations";
import { capabilitiesOf, isPluginActive, pluginManifest } from "@ledgerly/domain/platform/plugins";
import { institutionOf } from "@ledgerly/domain/platform/plugins";
import { providerCan, runBankPass } from "@ledgerly/plugin-host";
import { bankSink } from "./(app)/banks/sink";

/**
 * The pass of a plugin read by an engine of plugin-host — a source read with a token, a leave
 * calendar — chosen by its manifest: only for a person who has the plugin on (H25, H30). Off, there
 * is nothing to read and nothing is wrong.
 */
const engineRun: ProviderPass["run"] = async (person, ctx, due, now) => {
  if (!(await isPluginActive(ctx, due.provider.slice("plugin:".length)))) return "absent";
  if (await providerCan(due.provider, "leaveCalendar")) return ENGINE_PASSES.calendar(ctx);
  const connection = await findConnection(ctx, due.id);
  return connection ? ENGINE_PASSES.source(person, ctx, connection, now) : "absent";
};

registerPass({
  // Every `plugin:<id>` connection: the prefix stands for the family.
  provider: "plugin:",
  kinds: PLUGIN_KINDS,
  async run(person, ctx, due, now) {
    const engine =
      (await providerCan(due.provider, "source.read")) || (await providerCan(due.provider, "leaveCalendar"));
    return engine ? engineRun(person, ctx, due, now) : runBankPass(ctx, due, bankSink, now);
  },
  // A leave calendar's days are time off's: its scheduled reads stop while that addon is off.
  addon: async (provider) => addonOf(provider, await capabilitiesOf(provider)),
  // A bank's connection is named as the bank; any other as its plugin. The provider's name is the manifest's.
  async label(connection, locale) {
    const plugin = await pluginManifest(connection.provider.slice("plugin:".length));
    const provider = plugin?.labels.name[locale] ?? connection.provider;
    return { name: institutionOf(connection.instanceKey).name || provider, provider };
  },
});
