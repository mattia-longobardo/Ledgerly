// The one model of a plugin on the screens (H56, PERS-615 §1-§2): its state for the person, or the
// health of its connections when it is connected; the word, the tone and the main action of each.
// Every plugin follows it, whatever it reads: no provider is named here (rule M12).
import type { sources } from "@ledgerly/api-contract/settings";
import type { RouteOutput } from "@ledgerly/api-client";
import type { Tone } from "@ledgerly/ui/tone";

export type Plugin = RouteOutput<typeof sources.listPlugins>["plugins"][number];

type Health = NonNullable<Plugin["health"]>;

/** What the row and the page say: the state, or the health of a connected plugin. */
export type PluginStatus = Exclude<Plugin["pluginState"], "connected"> | Health;

export function statusOf(plugin: Pick<Plugin, "pluginState" | "health">): PluginStatus {
  if (plugin.pluginState !== "connected") return plugin.pluginState;
  return plugin.health ?? "up_to_date";
}

/** The tone of the word and of its dot: only today's tokens (§7). */
export const STATUS_TONE: Record<PluginStatus, Tone> = {
  not_active: "muted",
  not_connected: "muted",
  disconnected: "muted",
  needs_cleanup: "warn",
  up_to_date: "pos",
  reading: "accent",
  late: "warn",
  on_demand: "muted",
  error: "neg",
  action_needed: "neg",
};

/**
 * The main action of each state (§2): turn on, connect, connect again, clean up, or the action of
 * the connection that needs the person most (`connection`: «Update now», «Try again», «Renew access»…).
 * Up to date and reading ask for nothing.
 */
type PrimaryAction = "activate" | "connect" | "reconnect" | "fix" | "connection" | null;

export function primaryOf(status: PluginStatus): PrimaryAction {
  switch (status) {
    case "not_active":
      return "activate";
    case "not_connected":
      return "connect";
    case "disconnected":
      return "reconnect";
    case "needs_cleanup":
      return "fix";
    case "up_to_date":
    case "reading":
      return null;
    default:
      return "connection";
  }
}

/** The health that puts a banner with `role="alert"` on top of the page (§2, §5). */
export const alerts = (status: PluginStatus) => status === "error" || status === "action_needed";

/** A plugin that is on: its page has the sections of H55 and «Deactivate». */
export const isOn = (plugin: Pick<Plugin, "pluginState">) =>
  plugin.pluginState === "not_connected" ||
  plugin.pluginState === "connected" ||
  plugin.pluginState === "disconnected";

/** «Deactivate…» is in the menu of every plugin that is on or still has data here (§2). */
export const canDeactivate = (plugin: Pick<Plugin, "pluginState">) => plugin.pluginState !== "not_active";
