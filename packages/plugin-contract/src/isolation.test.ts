import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// Rule M9 of the rewrite plan (10-modularity.md §10.6), from N1: a plugin is isolated. A plugin
// imports its own files, the contract, and nothing else of the repository; the contract imports
// `zod` and nothing else. After R0 the contract is the package `plugin-contract` and this is the
// packages' boundary test.

const ROOT = process.cwd();
const CONTRACT = "packages/plugin-contract/src";
const PACKAGE = "@ledgerly/plugin-contract";
/** The tests reach the contract's files by the path alias of the tests. */
const TEST_ALIAS = "@plugin-contract/";
const IMPORT = /(?:from|import)\s+["']([^"']+)["']/g;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** Every import of a file, as a repository path when it is relative and as the package otherwise. */
function importsOf(file: string): string[] {
  const from = relative(ROOT, file).split(sep).join("/");
  return [...readFileSync(file, "utf8").matchAll(IMPORT)].map(([, specifier]) =>
    specifier.startsWith(".") ? posix.normalize(posix.join(dirname(from), specifier)) : specifier,
  );
}

/**
 * Plugins whose container is not in `docker-compose.yml` yet: written and tested, wired to the core
 * by a later step of R5c. The name leaves this list in the commit that adds its service.
 */
const NOT_DEPLOYED_YET = ["wallet"];

const isTest = (file: string) => /\.test\.ts$/.test(file);

describe("a plugin is isolated (M9)", () => {
  const plugins = readdirSync(join(ROOT, "plugins")).filter((name) =>
    statSync(join(ROOT, "plugins", name)).isDirectory(),
  );

  it("has plugins to read", () => {
    expect(plugins).toContain("enablebanking");
  });

  it.each(plugins)("%s imports only itself, the contract, Node and zod", (plugin) => {
    const own = `plugins/${plugin}/`;
    const outside = files(join(ROOT, "plugins", plugin)).flatMap((file) =>
      importsOf(file)
        .filter(
          (target) =>
            !target.startsWith(own) &&
            !target.startsWith(`${CONTRACT}/`) &&
            target !== PACKAGE &&
            !(isTest(file) && target.startsWith(TEST_ALIAS)) &&
            !target.startsWith("node:") &&
            target !== "zod" &&
            !(isTest(file) && target === "vitest"),
        )
        .map((target) => `${relative(ROOT, file)} → ${target}`),
    );
    expect(outside).toEqual([]);
  });

  it("the contract imports zod and its own files only", () => {
    const outside = files(join(ROOT, CONTRACT)).flatMap((file) =>
      importsOf(file)
        .filter(
          (target) =>
            !target.startsWith(`${CONTRACT}/`) &&
            target !== "zod" &&
            !(isTest(file) && (target === "vitest" || target.startsWith("node:"))),
        )
        .map((target) => `${relative(ROOT, file)} → ${target}`),
    );
    expect(outside).toEqual([]);
  });

  it.each(plugins)("%s has an image with no install script and no secret of the core", (plugin) => {
    const dockerfile = readFileSync(join(ROOT, "plugins", plugin, "Dockerfile"), "utf8");
    const installs = dockerfile.split("\n").filter((line) => /\bnpm (ci|install|i)\b/.test(line));
    expect(installs).toEqual(["RUN npm ci --ignore-scripts"]);
    expect(dockerfile).not.toMatch(/DATABASE_URL|APP_ENCRYPTION_KEY|\.env/);
  });

  it("the plugin's container gets no environment of the app, no volume and no public network", () => {
    const compose = readFileSync(join(ROOT, "docker-compose.yml"), "utf8");
    for (const plugin of plugins.filter((name) => !NOT_DEPLOYED_YET.includes(name))) {
      const start = compose.indexOf(`\n  ledgerly-plugin-${plugin}:`);
      expect(start).toBeGreaterThan(0);
      const service = compose.slice(start, compose.indexOf("\nnetworks:", start));
      expect(service).not.toContain(".env.homelab");
      expect(service).not.toContain("volumes:");
      expect(service).not.toContain("ports:");
      expect(service).toContain("read_only: true");
      expect(service).toContain('user: "1000:1000"');
      const networks = service.slice(service.lastIndexOf("networks:")).match(/- (\S+)/g);
      expect(networks).toEqual(["- ledgerly_plugins"]);
    }
  });
});
