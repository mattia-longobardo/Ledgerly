/**
 * The catalog of the official plugins (rewrite plan R5c, decisions H27, H28, D3): what the core
 * calls, the image each one runs and the digest of its bundle, and the hosts the egress proxy
 * opens for it. A plugin of `PLUGIN_URLS` that is not here is never called and never listed to a
 * person; only the server's diagnostics name it. The digest is held by `npm run plugins:catalog`
 * (written), `tools/plugin-catalog.test.ts` (against the source) and `scripts/plugins-check.sh`
 * (against the running containers): the core has no Docker socket to check it.
 */
import { z } from "zod";
import catalog from "./catalog.json";

/** A host name as the egress proxy compares it: lower case, no port, no scheme. */
const host = z
  .string()
  .regex(/^(?=.{1,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/);

const entrySchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,30}$/),
  /** The compose image, and the name of its container. */
  image: z.string().regex(/^ledgerly-plugin-[a-z0-9-]+$/),
  /** `sha256:` of the plugin's bundled `server.mjs`, built as its Dockerfile builds it. */
  digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  /** The hosts every person shares; the proxy opens them on port 443 only. */
  egress: z.array(host),
  /** The host is the person's own: the credential that carries its address, granted per call. */
  dynamicHost: z.strictObject({ credential: z.string().min(1) }).optional(),
});

type CatalogEntry = z.infer<typeof entrySchema>;

const PLUGIN_CATALOG: readonly CatalogEntry[] = z
  .strictObject({ plugins: z.array(entrySchema) })
  .refine((value) => new Set(value.plugins.map((entry) => entry.id)).size === value.plugins.length)
  .parse(catalog).plugins;

/** The catalog's entry of a plugin; `null` for a plugin that is not an official one. */
export function catalogEntry(pluginId: string): CatalogEntry | null {
  return PLUGIN_CATALOG.find((entry) => entry.id === pluginId) ?? null;
}
