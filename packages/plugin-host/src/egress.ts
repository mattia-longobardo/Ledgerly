/**
 * The grant of a person's own host to the egress proxy (rewrite plan R5c, decision D1). A plugin
 * whose catalog entry says its host is dynamic goes out only to the host the person saved in the
 * credential the entry names: before each call the core sends it to the proxy for a short time. No
 * provider is named here (rule M12): the catalog says which plugin, and which credential.
 */
import { catalogEntry } from "@ledgerly/domain/platform/plugins";
import { readEnv } from "@ledgerly/domain/platform/env";
import type { Fetch } from "./client";

/** Longer than the longest call (a calendar's write, 120 s), short enough to close soon after. */
const GRANT_SECONDS = 300;
const GRANT_TIMEOUT_MS = 3_000;

/**
 * Grants the proxy the host of this connection's credentials, when the plugin's host is dynamic.
 * Never throws: without the grant the proxy refuses the plugin's call, and that call fails as the
 * plugin reports it. The proxy checks the host's addresses itself; the core only sends the name.
 */
export async function grantDynamicHost(
  pluginId: string,
  credentials: Record<string, string>,
  fetchFn: Fetch = fetch,
): Promise<void> {
  const field = catalogEntry(pluginId)?.dynamicHost?.credential;
  const { EGRESS_URL: url, EGRESS_ADMIN_SECRET: secret } = readEnv();
  const address = field === undefined ? undefined : credentials[field];
  if (address === undefined || url === undefined || secret === undefined || !URL.canParse(address)) return;
  try {
    const response = await fetchFn(`${url.replace(/\/+$/, "")}/grants`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ plugin: pluginId, host: new URL(address).hostname, ttlSeconds: GRANT_SECONDS }),
      signal: AbortSignal.timeout(GRANT_TIMEOUT_MS),
    });
    if (!response.ok)
      console.warn(`[plugins] ${pluginId}: the egress proxy refused the host (${response.status})`);
  } catch {
    console.warn(`[plugins] ${pluginId}: the egress proxy did not answer the grant`);
  }
}
