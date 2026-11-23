// scripts/plugins-catalog.ts — `npm run plugins:catalog`: writes the digest of each official plugin
// into its catalog (packages/domain/src/platform/plugins/catalog.json, decision H28).
//
// The digest is the sha256 of the plugin's `server.mjs`, bundled with the options of its Dockerfile
// from the repository root: esbuild's output is the same bytes for the same source and the same
// lockfile, here and in the image's `/app/server.mjs`. Not the image's digest: an image built here
// has no registry digest, and its layers carry times. `tools/plugin-catalog.test.ts` fails when a
// digest no longer matches the source; `scripts/plugins-check.sh` holds the running containers to it.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { format } from "prettier";

export const CATALOG = "packages/domain/src/platform/plugins/catalog.json";

/** `sha256:<hex>` of the bundle of `plugins/<id>`, as `RUN ./node_modules/.bin/esbuild …` makes it. */
export async function bundleDigest(repo: string, id: string): Promise<string> {
  const result = await build({
    absWorkingDir: repo,
    entryPoints: [`plugins/${id}/src/server.ts`],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node26",
    outfile: "server.mjs",
    write: false,
    logLevel: "silent",
  });
  return `sha256:${createHash("sha256").update(result.outputFiles[0].contents).digest("hex")}`;
}

if (process.argv[1]?.endsWith("plugins-catalog.ts")) {
  const repo = process.cwd();
  const path = join(repo, CATALOG);
  const catalog = JSON.parse(readFileSync(path, "utf8")) as { plugins: { id: string; digest: string }[] };
  for (const entry of catalog.plugins) {
    entry.digest = await bundleDigest(repo, entry.id);
    console.log(`${entry.id} ${entry.digest}`);
  }
  writeFileSync(path, await format(JSON.stringify(catalog), { filepath: path }));
}
