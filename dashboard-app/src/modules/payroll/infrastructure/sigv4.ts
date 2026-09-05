import { createHash, createHmac } from "node:crypto";

/**
 * AWS Signature Version 4, in about eighty lines of `node:crypto`.
 *
 * This is protocol code, not provider code: it names S3 and AWS (a protocol and
 * its specification) and never the `silo` container, so it does not fall under
 * the "provider names only in `*-adapter.ts`" rule. The alternative was
 * `@aws-sdk/client-s3`, a multi-megabyte dependency for four verbs, against the
 * precedent set by `src/platform/integrations/crypto.ts` hand-rolling AES-GCM.
 */
export interface SigV4Input {
  method: string;
  url: URL;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Hex sha256 of the body; `hashPayload(new Uint8Array())` for a bodyless request. */
  payloadHash: string;
  /** Must include `host`. Names are lower-cased and values trimmed before signing. */
  headers: Record<string, string>;
  at: Date;
}

export function hashPayload(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

/** RFC 3986 unreserved set, which is narrower than `encodeURIComponent`'s. */
function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Every segment is encoded; the separators are not. S3 canonicalises paths exactly this way. */
function canonicalPath(pathname: string): string {
  return pathname.split("/").map(uriEncode).join("/") || "/";
}

function canonicalQuery(url: URL): string {
  const pairs: Array<[string, string]> = [];
  url.searchParams.forEach((v, k) => pairs.push([uriEncode(k), uriEncode(v)]));
  pairs.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  return pairs.map(([k, v]) => `${k}=${v}`).join("&");
}

function amzDate(at: Date): string {
  return at.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * Returns every header the request must carry, the `Authorization` header
 * included. The caller sends exactly these — adding a header afterwards
 * invalidates the signature, because `SignedHeaders` is fixed here.
 */
export function signRequest(input: SigV4Input): Record<string, string> {
  const stamp = amzDate(input.at);
  const day = stamp.slice(0, 8);

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.headers)) {
    headers[name.toLowerCase()] = value.trim().replace(/\s+/g, " ");
  }
  headers["x-amz-date"] = stamp;
  headers["x-amz-content-sha256"] = input.payloadHash;

  const signedNames = Object.keys(headers).sort();
  const canonicalHeaders = signedNames.map((n) => `${n}:${headers[n]}\n`).join("");
  const signedHeaders = signedNames.join(";");

  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalPath(input.url.pathname),
    canonicalQuery(input.url),
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join("\n");

  const scope = `${day}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256Hex(canonicalRequest)].join("\n");

  const signingKey = hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, day), input.region), input.service), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  headers["authorization"] =
    `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return headers;
}
