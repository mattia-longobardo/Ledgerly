import type { DocumentStore } from "../application/ports";
import { assertStorageKey } from "../domain/document";
import { hashPayload, signRequest } from "./sigv4";

export interface S3StoreConfig {
  /** Origin only, e.g. `https://silo.internal` — no bucket, no trailing slash. */
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Injected in tests so the suite never opens a socket. */
  fetchImpl?: typeof fetch;
}

/** MinIO-family servers do not accept a `Key` element containing raw XML entities we would have to unescape. */
const KEY_TAG = /<Key>([^<]*)<\/Key>/g;
const TRUNCATED = /<IsTruncated>\s*true\s*<\/IsTruncated>/i;
const NEXT_TOKEN = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/;

/**
 * The S3-compatible adapter. Path-style addressing (`{endpoint}/{bucket}/{key}`)
 * because the silo is reached by an internal hostname with no per-bucket DNS.
 *
 * Every response is checked by status: a 404 on GET is `null` (an object the
 * retention job already purged), a 404 on DELETE is success (idempotency,
 * Ruling R4-5), and anything else throws with the status in the message so a
 * broken store is never mistaken for an absent object.
 */
export function createS3DocumentStore(config: S3StoreConfig): DocumentStore {
  const doFetch = config.fetchImpl ?? fetch;
  const origin = config.endpoint.replace(/\/+$/, "");

  async function send(method: string, url: URL, body: Uint8Array | null, extraHeaders: Record<string, string> = {}) {
    const payloadHash = hashPayload(body ?? new Uint8Array());
    const headers = signRequest({
      method,
      url,
      region: config.region,
      service: "s3",
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      payloadHash,
      headers: { host: url.host, ...extraHeaders },
      at: new Date(),
    });
    // A single `Request` argument, not `(url, init)`: `fetchImpl` in the test
    // suite reads the request it was called with straight off the mock call —
    // there is nowhere else for `method`/`url`/`headers` to come from once the
    // call has already happened.
    const request = new Request(url, { method, headers, ...(body ? { body: body as BodyInit } : {}) });
    return doFetch(request);
  }

  function urlFor(key: string): URL {
    // Same key contract `local-document-store.ts` enforces (Finding 2): a key
    // containing `?`, `#`, or `..` would silently change which object a
    // validly-signed request addresses once interpolated into this URL.
    assertStorageKey(key);
    return new URL(`${origin}/${config.bucket}/${key}`);
  }

  return {
    provider: "silo",

    async put(key, bytes, contentType) {
      const res = await send("PUT", urlFor(key), bytes, {
        "content-type": contentType,
        "content-length": String(bytes.byteLength),
      });
      if (!res.ok) throw new Error(`document store PUT failed: ${res.status}`);
    },

    async get(key) {
      const res = await send("GET", urlFor(key), null);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`document store GET failed: ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },

    async delete(key) {
      const res = await send("DELETE", urlFor(key), null);
      if (res.status === 404) return;
      if (!res.ok) throw new Error(`document store DELETE failed: ${res.status}`);
    },

    async listPrefix(prefix) {
      assertStorageKey(prefix.endsWith("/") ? prefix.slice(0, -1) : prefix);
      const keys: string[] = [];
      let token: string | null = null;
      // Bounded: a per-user prefix cannot legitimately hold more than a few
      // hundred payslips, and an unbounded loop against a misbehaving store
      // would hang the disconnect path.
      for (let page = 0; page < 50; page += 1) {
        const url = new URL(`${origin}/${config.bucket}`);
        url.searchParams.set("list-type", "2");
        url.searchParams.set("prefix", prefix);
        if (token) url.searchParams.set("continuation-token", token);
        const res = await send("GET", url, null);
        if (!res.ok) throw new Error(`document store LIST failed: ${res.status}`);
        const xml = await res.text();
        for (const match of xml.matchAll(KEY_TAG)) keys.push(match[1]!);
        if (!TRUNCATED.test(xml)) return keys;
        token = NEXT_TOKEN.exec(xml)?.[1] ?? null;
        if (!token) return keys;
      }
      throw new Error("document store LIST did not terminate after 50 pages");
    },
  };
}
