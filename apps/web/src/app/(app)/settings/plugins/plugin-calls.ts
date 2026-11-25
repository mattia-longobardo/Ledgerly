// The person's plugin and the section "Banks" (ux/n1-plugin-bank.md §2-§5) through `/api/v1/plugins`
// and `/api/v1/connections` (rewrite plan R3). Each answers as the Server Action it replaces: `ok`, or
// the plugin host's code (`key_format`, `credentials_invalid`…); a failure of the server is `failed`.
// None returns a credential: there is no field a key could travel in.
import { banks, connections } from "@ledgerly/api-contract/settings";
import { ApiError, call } from "@ledgerly/api-client";
import { invalidate } from "@ledgerly/ui/data";

export type PluginActionResult = { ok: true } | { ok: false; error: string };

async function attempt(work: () => Promise<unknown>): Promise<PluginActionResult> {
  try {
    await work();
  } catch (error) {
    if (error instanceof ApiError && error.status < 500)
      return { ok: false, error: error.reason ?? error.code };
    return { ok: false, error: "failed" };
  }
  invalidate(connections.listConnections);
  return { ok: true };
}

/** «Activate»: a `404` is an instance without the plugin, said `not_available` (H56, PERS-615 §5). */
export async function activatePlugin(pluginId: string): Promise<PluginActionResult> {
  const result = await attempt(() =>
    call(banks.setPluginActive, { params: { pluginId }, body: { active: true } }),
  );
  return !result.ok && result.error === "not_found" ? { ok: false, error: "not_available" } : result;
}

const MAX_KEY_FILE_BYTES = 16_384;

/**
 * Checks and saves the credentials of the form (§4.1, §4.2). The key comes as text or as a file; with
 * both, the file wins. The file is read here, in the browser, and goes as text.
 */
export async function saveBankCredentials(pluginId: string, form: FormData): Promise<PluginActionResult> {
  const file = form.get("keyFile");
  const typed = form.get("privateKey");
  let privateKey = typeof typed === "string" ? typed : "";
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_KEY_FILE_BYTES) return { ok: false, error: "key_format" };
    privateKey = await file.text();
  }
  // Longer than any key the route takes: the plugin host's word for a key it cannot read.
  if (privateKey.length > MAX_KEY_FILE_BYTES) return { ok: false, error: "key_format" };
  const applicationId = form.get("applicationId");
  return attempt(() =>
    call(banks.savePluginCredentials, {
      params: { pluginId },
      body: { applicationId: typeof applicationId === "string" ? applicationId : "", privateKey },
    }),
  );
}

export const removeBankCredentials = (pluginId: string) =>
  attempt(() => call(banks.removePluginCredentials, { params: { pluginId } }));

/** Disconnects one of the bank's connections: the route is the bank plugin's own. */
export const disconnectBank = (connectionId: string) =>
  attempt(() => call(connections.disconnect, { params: { id: connectionId } }));
