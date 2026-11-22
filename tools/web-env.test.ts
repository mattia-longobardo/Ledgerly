// The interface's container has no key of the server (rewrite plan R4, criterion 1): its service in
// `docker-compose.yml` names only the variables of the allowlist, takes no environment file but
// `.env.web`, and `.env.web`, where it exists (the server, never the repository), holds only those.
// The compose file is read as text: the test runs where Docker does not (CI), and no YAML package
// is added for one block.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");

/** What the interface may know, and why: none of it is a secret. */
const ALLOWED = new Set([
  "LEDGERLY_API_URL", // where the server is, on `ledgerly_internal`
  "OIDC_DISCOVERY_URL", // the identity provider's origin, for the CSP's `form-action`
  "INSTANCE_CONTACT", // the contact of the public `/privacy` and `/terms`
]);

/** The names of the server's own: the ones the criterion names first, and the rest of its keys. */
const SERVER_ONLY = [
  "DATABASE_URL",
  "APP_ENCRYPTION_KEY",
  "BETTER_AUTH_SECRET",
  "OIDC_CLIENT_SECRET",
  "SMTP_PASSWORD",
  "S3_SECRET_ACCESS_KEY",
  "PLUGIN_SECRETS",
  "CRON_SECRET",
  "METRICS_TOKEN",
  "GOTIFY_TOKEN",
];

/** The lines of one service of `docker-compose.yml`, up to the next key at its indentation. */
function serviceBlock(compose: string, name: string): string[] {
  const lines = compose.split("\n");
  const start = lines.indexOf(`  ${name}:`);
  if (start < 0) throw new Error(`no service ${name}`);
  const end = lines.findIndex((line, index) => index > start && /^ {2}[a-z][\w-]*:/.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end);
}

/** The names under a key of the block (`environment:`), or the paths of `env_file:`. */
function entriesUnder(block: string[], key: string): string[] {
  const start = block.indexOf(`    ${key}:`);
  if (start < 0) return [];
  const entries: string[] = [];
  for (const line of block.slice(start + 1)) {
    if (!/^ {6}/.test(line)) break;
    const name =
      /^ {6}([A-Z_][A-Z0-9_]*):/.exec(line)?.[1] ??
      /path:\s*(\S+)/.exec(line)?.[1] ??
      /^ {6}- (\S+)/.exec(line)?.[1];
    if (name) entries.push(name);
  }
  return entries;
}

const web = serviceBlock(readFileSync(join(ROOT, "docker-compose.yml"), "utf8"), "ledgerly-web");

describe("the interface's container (R4)", () => {
  it("names only variables of the allowlist", () => {
    const names = entriesUnder(web, "environment");
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name) => !ALLOWED.has(name))).toEqual([]);
  });

  it("reads no environment file but .env.web", () => {
    expect(entriesUnder(web, "env_file")).toEqual([".env.web"]);
  });

  it("names no key of the server anywhere in its service", () => {
    const text = web.join("\n");
    expect(SERVER_ONLY.filter((name) => text.includes(name))).toEqual([]);
  });

  it("is not on the networks of the database, the mail or the plugins", () => {
    expect(entriesUnder(web, "networks")).toEqual(["proxy_public", "ledgerly_internal"]);
  });

  it.runIf(existsSync(join(ROOT, ".env.web")))(".env.web, where it exists, holds only the allowlist", () => {
    const names = readFileSync(join(ROOT, ".env.web"), "utf8")
      .split("\n")
      .map((line) => /^\s*([A-Z_][A-Z0-9_]*)\s*=/.exec(line)?.[1])
      .filter((name): name is string => name !== undefined);
    expect(names.filter((name) => !ALLOWED.has(name))).toEqual([]);
  });
});
