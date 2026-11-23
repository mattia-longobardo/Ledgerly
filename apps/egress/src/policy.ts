/**
 * What the egress proxy allows, read once at start: the catalog of the official plugins (the file
 * the core reads, copied into the image) and the secrets of the environment. Read with plain checks:
 * the proxy is `node:*` only. Error messages name the variable or the entry, never a value.
 */
import { createHash, timingSafeEqual } from "node:crypto";

export interface Policy {
  /** The hosts every person shares, by plugin. */
  hosts: ReadonlyMap<string, readonly string[]>;
  /** The plugins whose host is the person's own, opened by a grant of the core. */
  dynamic: ReadonlySet<string>;
  /** The secret of each plugin, for `Proxy-Authorization`. */
  secrets: ReadonlyMap<string, string>;
  /** The core's secret, for `POST /grants`. */
  adminSecret: string;
}

const MIN_SECRET_LENGTH = 32;
const PLUGIN_ID = /^[a-z][a-z0-9-]{1,30}$/;
/** A host name: lower case labels, at least one dot. Never an address, never a port. */
export const HOST_NAME = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function readCatalog(text: string): Pick<Policy, "hosts" | "dynamic"> {
  const catalog: unknown = JSON.parse(text);
  if (!isRecord(catalog) || !Array.isArray(catalog.plugins)) throw new Error("catalog: no plugins");
  const hosts = new Map<string, string[]>();
  const dynamic = new Set<string>();
  for (const [index, entry] of catalog.plugins.entries()) {
    const egress: unknown = isRecord(entry) ? entry.egress : undefined;
    if (
      !isRecord(entry) ||
      typeof entry.id !== "string" ||
      !PLUGIN_ID.test(entry.id) ||
      !Array.isArray(egress)
    )
      throw new Error(`catalog: entry ${index + 1} is not a plugin`);
    const names = egress.filter((name): name is string => typeof name === "string" && HOST_NAME.test(name));
    if (names.length !== egress.length)
      throw new Error(`catalog: entry ${index + 1} has a host that is not one`);
    hosts.set(entry.id, names);
    if (entry.dynamicHost !== undefined) dynamic.add(entry.id);
  }
  return { hosts, dynamic };
}

/** `id=secret[,id=secret…]`: every id a plugin of the catalog, every secret of 32+ characters. */
function readSecrets(spec: string | undefined, known: ReadonlyMap<string, unknown>): Map<string, string> {
  const secrets = new Map<string, string>();
  for (const [index, pair] of (spec ?? "")
    .split(",")
    .filter((part) => part.trim() !== "")
    .entries()) {
    const separator = pair.indexOf("=");
    const id = pair.slice(0, Math.max(separator, 0)).trim();
    const secret = pair.slice(separator + 1).trim();
    if (!known.has(id)) throw new Error(`EGRESS_SECRETS: entry ${index + 1} is not a plugin of the catalog`);
    if (secret.length < MIN_SECRET_LENGTH) throw new Error(`EGRESS_SECRETS: the secret of "${id}" is short`);
    secrets.set(id, secret);
  }
  return secrets;
}

export function readPolicy(env: Record<string, string | undefined>, catalogText: string): Policy {
  const { hosts, dynamic } = readCatalog(catalogText);
  const adminSecret = env.EGRESS_ADMIN_SECRET ?? "";
  if (adminSecret.length < MIN_SECRET_LENGTH) throw new Error("EGRESS_ADMIN_SECRET: 32+ characters");
  return { hosts, dynamic, secrets: readSecrets(env.EGRESS_SECRETS, hosts), adminSecret };
}

/** Two secrets compared in constant time, whatever their lengths. */
export function sameSecret(given: string, expected: string): boolean {
  const digest = (text: string) => createHash("sha256").update(text).digest();
  return timingSafeEqual(digest(given), digest(expected)) && given.length === expected.length;
}

/** The plugin a `Proxy-Authorization: Basic <id:secret>` header proves; `null` for anything else. */
export function pluginOf(policy: Policy, header: string | undefined): string | null {
  const match = /^Basic\s+([A-Za-z0-9+/=]+)$/.exec(header ?? "");
  if (match === null) return null;
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  const id = decoded.slice(0, Math.max(separator, 0));
  const expected = policy.secrets.get(id);
  return expected !== undefined && sameSecret(decoded.slice(separator + 1), expected) ? id : null;
}
