/**
 * Reading `APP_ENCRYPTION_KEY`, kept apart from the sealing in `crypto.ts` for one reason:
 * `src/platform/env.ts` validates the key ring at boot, `src/instrumentation.ts` imports `env.ts`,
 * and Next analyses instrumentation for the Edge runtime too — so importing `crypto.ts` there
 * dragged `node:crypto` into an Edge bundle and warned on every build. Nothing here needs it:
 * parsing a key ring is `Buffer` and string work, and only `seal`/`open` are cryptography.
 */

/** A rotatable set of AES-256 keys parsed from `APP_ENCRYPTION_KEY`. The first key seals; every key can open. */
export interface KeyRing {
  activeId: string;
  keys: ReadonlyMap<string, Buffer>;
}

export const KEY_ID = /^[a-z0-9_-]{1,32}$/;

/**
 * Parses `APP_ENCRYPTION_KEY`: `"k2:<base64 32 bytes>,k1:<base64 32 bytes>"`. The first key seals.
 * Error messages never echo raw entry text (an operator typo can put a key where an id is expected):
 * a malformed id is reported by its position, not its content.
 */
export function parseKeyRing(spec: string): KeyRing {
  const entries = spec
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0) throw new Error("APP_ENCRYPTION_KEY is empty");
  const keys = new Map<string, Buffer>();
  for (const [index, entry] of entries.entries()) {
    const separator = entry.indexOf(":");
    const id = separator > 0 ? entry.slice(0, separator) : "";
    const encoded = entry.slice(separator + 1);
    if (!KEY_ID.test(id)) {
      throw new Error(`Invalid key id in APP_ENCRYPTION_KEY entry ${index + 1}`);
    }
    const key = Buffer.from(encoded, "base64");
    if (key.length !== 32 || key.toString("base64") !== encoded) {
      throw new Error(`Key "${id}" must be 32 bytes of canonical base64`);
    }
    if (keys.has(id)) throw new Error(`Duplicate key id "${id}" in APP_ENCRYPTION_KEY`);
    keys.set(id, key);
  }
  return { activeId: [...keys.keys()][0], keys };
}
