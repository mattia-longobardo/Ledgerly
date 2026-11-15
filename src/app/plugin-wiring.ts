// src/app/plugin-wiring.ts — where the application joins the plugin runtime to the rest (rewrite
// plan, rule M8). Importing this file registers the pass the dispatcher makes for a plugin's
// connections: the registry of passes must not import the runtime, and the runtime must not
// import the modules, so the one place that knows both is here.
//
// Every entry that can start a pass imports it: the tick of the cron sidecar and "Run now".
import "server-only";
import { registerPass } from "@/platform/integrations/registry";
import { PLUGIN_KINDS } from "@/platform/integrations/rules";
import { runBankPass } from "@/platform/plugins/sync";
import { bankSink } from "./(app)/banks/sink";

registerPass({
  // Every `plugin:<id>` connection: the prefix stands for the family.
  provider: "plugin:",
  kinds: PLUGIN_KINDS,
  run: (_person, ctx, due, now) => runBankPass(ctx, due, bankSink, now),
});
