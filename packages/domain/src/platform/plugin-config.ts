/**
 * The plugins the server's configuration names (rewrite plan, 04-now.md §4.1, "Installazione"):
 * the core knows a plugin from its environment and from nowhere else. Parsing only — no
 * environment is read here and nothing of the plugin runtime is imported, so `env.ts` can check
 * the two values at boot without the runtime and the environment importing each other.
 */

/** The id of a plugin: the same pattern the contract's manifest uses. */
const PLUGIN_ID = /^[a-z][a-z0-9-]{1,30}$/;

export interface ConfiguredPlugin {
  id: string;
  /** Where the core reaches the plugin, on the stack's own network. */
  url: string;
  /** The secret the core and this plugin share. Never stored, never logged. */
  secret: string;
}

const MIN_SECRET_LENGTH = 32;

/** `id=value[,id=value…]` as a map. Error messages name the position, never the text. */
function pairs(spec: string | undefined, what: string): Map<string, string> {
  const found = new Map<string, string>();
  const entries = (spec ?? "").split(",").map((entry) => entry.trim());
  for (const [index, entry] of entries.filter(Boolean).entries()) {
    const separator = entry.indexOf("=");
    const id = separator > 0 ? entry.slice(0, separator) : "";
    if (!PLUGIN_ID.test(id)) throw new Error(`Invalid plugin id in ${what} entry ${index + 1}`);
    if (found.has(id)) throw new Error(`Duplicate plugin "${id}" in ${what}`);
    found.set(id, entry.slice(separator + 1));
  }
  return found;
}

/**
 * The configured plugins, by id. Every plugin with an address needs a secret of 32 characters or
 * more, and a secret with no address is a mistake worth stopping for.
 */
export function parsePluginConfig(urls: string | undefined, secrets: string | undefined): ConfiguredPlugin[] {
  const addresses = pairs(urls, "PLUGIN_URLS");
  const shared = pairs(secrets, "PLUGIN_SECRETS");
  for (const id of shared.keys()) {
    if (!addresses.has(id)) throw new Error(`Plugin "${id}" has a secret and no address`);
  }
  return [...addresses].map(([id, url]) => {
    if (!URL.canParse(url) || !/^https?:$/.test(new URL(url).protocol)) {
      throw new Error(`Plugin "${id}" has an address that is not an http(s) URL`);
    }
    const secret = shared.get(id) ?? "";
    if (secret.length < MIN_SECRET_LENGTH) {
      throw new Error(`Plugin "${id}" needs a secret of ${MIN_SECRET_LENGTH}+ characters in PLUGIN_SECRETS`);
    }
    return { id, url: url.replace(/\/+$/, ""), secret };
  });
}
