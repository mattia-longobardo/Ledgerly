/**
 * Whether one `CONNECT` of a plugin may go out, and to which address (rewrite plan R5c, decision
 * I8): only port 443, so TLS stays end to end; only a host of the plugin's catalog entry or of a
 * live grant; only a name whose every address is public. The proxy resolves the name itself and
 * the caller connects to the very address checked here: no second resolution, no DNS rebinding.
 */
import { isIP } from "node:net";
import { isForbiddenAddress } from "./addresses.ts";
import type { Grants } from "./grants.ts";
import { type Policy, pluginOf } from "./policy.ts";

export type Lookup = (host: string) => Promise<readonly { address: string }[]>;

export interface AccessDeps {
  policy: Policy;
  grants: Grants;
  lookup: Lookup;
}

type Decision =
  | { ok: true; plugin: string; host: string; address: string }
  | { ok: false; status: 403 | 407 | 502; reason: string; plugin: string | null };

/** `host:443` or `[v6]:443` → host and port; `null` for anything else. */
function splitTarget(target: string): { host: string; port: number } | null {
  const match = /^(?:\[([0-9a-fA-F:.]+)\]|([^:[\]]+)):(\d{1,5})$/.exec(target);
  if (match === null) return null;
  const host = (match[1] ?? match[2]).toLowerCase().replace(/\.$/, "");
  return { host, port: Number(match[3]) };
}

/**
 * The addresses of `host`, if every one of them is public; `null` when one is not (a name that
 * also points inside the homelab is refused as a whole) or when it has none.
 */
export async function publicAddresses(lookup: Lookup, host: string): Promise<string[] | null> {
  let addresses: string[];
  try {
    addresses = isIP(host) === 0 ? (await lookup(host)).map((found) => found.address) : [host];
  } catch {
    return null;
  }
  if (addresses.length === 0 || addresses.some(isForbiddenAddress)) return null;
  return addresses;
}

export async function decide(
  deps: AccessDeps,
  request: { target: string; authorization: string | undefined },
  now = Date.now(),
): Promise<Decision> {
  const plugin = pluginOf(deps.policy, request.authorization);
  if (plugin === null) return { ok: false, status: 407, reason: "unauthenticated", plugin };
  const target = splitTarget(request.target);
  if (target === null || target.port !== 443) return { ok: false, status: 403, reason: "port", plugin };
  const { host } = target;
  const listed = deps.policy.hosts.get(plugin)?.includes(host) === true;
  if (!listed && !deps.grants.allows(plugin, host, now))
    return { ok: false, status: 403, reason: "host", plugin };
  const addresses = await publicAddresses(deps.lookup, host);
  if (addresses === null) return { ok: false, status: 403, reason: "address", plugin };
  return { ok: true, plugin, host, address: addresses[0] };
}
