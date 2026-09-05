import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix, resolve, sep } from "node:path";
import type { DocumentStore } from "../application/ports";
import { assertStorageKey } from "../domain/document";

/**
 * The development and test driver (Ruling R4-16): the production container is
 * `read_only: true` with only tmpfs mounts, so a local store there would either
 * fail to write or silently lose originals on restart. `documentStoreResolver`
 * (Task 3) is what refuses it in production; this adapter simply does its job.
 *
 * Path traversal is checked twice — by the key shape, and by re-resolving the
 * absolute path against the root — because a store that can be talked into
 * reading `/etc/passwd` would be reachable through an API route that streams
 * whatever it reads back to the caller.
 */
export function createLocalDocumentStore(root: string): DocumentStore {
  const absoluteRoot = resolve(root);

  function pathFor(key: string): string {
    assertStorageKey(key);
    const full = resolve(join(absoluteRoot, ...key.split("/")));
    if (full !== absoluteRoot && !full.startsWith(absoluteRoot + sep)) {
      throw new Error(`invalid storage key: ${key}`);
    }
    return full;
  }

  async function keysUnder(dir: string, prefix: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const out: string[] = [];
    for (const entry of entries) {
      const childKey = prefix === "" ? entry.name : posix.join(prefix, entry.name);
      if (entry.isDirectory()) out.push(...(await keysUnder(join(dir, entry.name), childKey)));
      else out.push(childKey);
    }
    return out;
  }

  return {
    provider: "local",

    async put(key, bytes) {
      const path = pathFor(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
    },

    async get(key) {
      const path = pathFor(key);
      try {
        return new Uint8Array(await readFile(path));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
    },

    async delete(key) {
      // `force` makes this idempotent: the retention job may re-run over a row
      // whose object it already removed (Ruling R4-5).
      await rm(pathFor(key), { force: true });
    },

    async listPrefix(prefix) {
      assertStorageKey(prefix.endsWith("/") ? prefix.slice(0, -1) : prefix);
      const all = await keysUnder(absoluteRoot, "");
      return all.filter((k) => k.startsWith(prefix));
    },
  };
}
