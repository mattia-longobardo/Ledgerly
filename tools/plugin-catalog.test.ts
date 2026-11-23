import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readPolicy } from "../apps/egress/src/policy.ts";
import { bundleDigest, CATALOG } from "../scripts/plugins-catalog";

// The catalog of the official plugins (decisions H27, H28) against the tree: one entry per plugin
// folder, a digest equal to a fresh bundle of the source, the image compose builds, the hosts the
// plugin's manifest declares. A change to a plugin's source fails here until `npm run plugins:catalog`.

const ROOT = process.cwd();
const catalog: {
  plugins: {
    id: string;
    image: string;
    digest: string;
    egress: string[];
    dynamicHost?: { credential: string };
  }[];
} = JSON.parse(readFileSync(join(ROOT, CATALOG), "utf8"));
const folders = readdirSync(join(ROOT, "plugins")).filter((name) =>
  statSync(join(ROOT, "plugins", name)).isDirectory(),
);
const compose = readFileSync(join(ROOT, "docker-compose.yml"), "utf8");

describe("the catalog of the official plugins", () => {
  it("has one entry per plugin folder", () => {
    expect(catalog.plugins.map((entry) => entry.id).sort()).toEqual([...folders].sort());
  });

  it.each(catalog.plugins)("$id: its digest is the one of a fresh bundle of its source", async (entry) => {
    expect(await bundleDigest(ROOT, entry.id)).toBe(entry.digest);
  });

  it.each(catalog.plugins)("$id: compose builds its image into a container of the same name", (entry) => {
    expect(entry.image).toBe(`ledgerly-plugin-${entry.id}`);
    expect(compose).toContain(`\n    image: ${entry.image}:latest\n    container_name: ${entry.image}\n`);
  });

  it.each(catalog.plugins)("$id: its hosts are the ones its manifest declares", async (entry) => {
    const { MANIFEST } = await import(`../plugins/${entry.id}/src/manifest.ts`);
    expect(entry.egress).toEqual(MANIFEST.egress);
    // A plugin whose host is the person's own declares none, and names the credential that holds it.
    if (entry.dynamicHost === undefined) return;
    expect(MANIFEST.egress).toEqual([]);
    const names = MANIFEST.userSettings.map((field: { name: string }) => field.name);
    expect(names).toContain(entry.dynamicHost.credential);
  });

  it("is the policy of the egress proxy: the hosts of each plugin, and the one whose host is dynamic", () => {
    const policy = readPolicy(
      { EGRESS_ADMIN_SECRET: "a".repeat(32) },
      readFileSync(join(ROOT, CATALOG), "utf8"),
    );
    expect(Object.fromEntries(policy.hosts)).toEqual(
      Object.fromEntries(catalog.plugins.map((entry) => [entry.id, entry.egress])),
    );
    expect([...policy.dynamic]).toEqual(
      catalog.plugins.filter((entry) => entry.dynamicHost).map((entry) => entry.id),
    );
  });
});
