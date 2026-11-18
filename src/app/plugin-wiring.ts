// src/app/plugin-wiring.ts — where the application joins the plugin runtime to the rest (rewrite
// plan, rule M8). Importing this file registers the pass the dispatcher makes for a plugin's
// connections: the registry of passes must not import the runtime, and the runtime must not
// import the modules, so the one place that knows both is here.
//
// Every entry that can start a pass imports it: the tick of the cron sidecar and "Run now".
import "server-only";
import { registerPass } from "@/platform/integrations/registry";
import { PLUGIN_KINDS } from "@ledgerly/domain/platform/integrations";
import { findInstancePlugin } from "@ledgerly/domain/platform/plugins";
import { institutionOf } from "@ledgerly/domain/platform/plugins";
import { runBankPass } from "@ledgerly/plugin-host";
import { bankSink } from "./(app)/banks/sink";

registerPass({
  // Every `plugin:<id>` connection: the prefix stands for the family.
  provider: "plugin:",
  kinds: PLUGIN_KINDS,
  run: (_person, ctx, due, now) => runBankPass(ctx, due, bankSink, now),
  // A connection is a bank, named as the bank; the provider's name is the manifest's.
  async label(connection, locale) {
    const plugin = await findInstancePlugin(connection.provider.slice("plugin:".length));
    return {
      name: institutionOf(connection.instanceKey).name || connection.provider,
      provider: plugin?.manifest.labels.name[locale] ?? connection.provider,
    };
  },
});
