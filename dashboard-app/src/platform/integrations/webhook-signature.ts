import { createHmac, timingSafeEqual } from "node:crypto";
import type { WebhookRequest } from "./types";

/** The header every adapter reads its signature from, unless it says otherwise. */
const DEFAULT_SIGNATURE_HEADER = "x-signature";

/**
 * `X-Signature: sha256=<hex>` over the RAW request body (spec §6). Shared by
 * every adapter rather than reimplemented per provider, because getting the
 * comparison wrong is the whole vulnerability: the presented value is shape-
 * checked and hex-decoded to a fixed 32 bytes before `timingSafeEqual`, so
 * neither its length nor its prefix leaks through an early return.
 */
export function verifyHmacSignature(input: {
  rawBody: string;
  presented: string | null;
  secret: string;
}): boolean {
  if (!input.secret) return false;
  const presented = (input.presented ?? "").trim().replace(/^sha256=/i, "");
  if (!/^[0-9a-f]{64}$/i.test(presented)) return false;
  const expected = createHmac("sha256", input.secret).update(input.rawBody, "utf8").digest();
  return timingSafeEqual(Buffer.from(presented, "hex"), expected);
}

/**
 * The `webhook.verify` every adapter uses. It lives here, not in each
 * `*-adapter.ts`, because the two adapters were otherwise character-for-
 * character identical — and a verifier duplicated per provider is a verifier
 * that can be fixed in one place and left broken in the other. Nothing
 * provider-specific is expressed here beyond the header name, which each
 * adapter may override.
 */
export function hmacSignatureVerifier(
  headerName: string = DEFAULT_SIGNATURE_HEADER,
): (req: WebhookRequest, secret: string) => boolean {
  return (req, secret) =>
    verifyHmacSignature({ rawBody: req.rawBody, presented: req.headers.get(headerName), secret });
}

/**
 * The event name out of a decoded webhook payload, or `"unknown"`.
 *
 * Also shared for the same reason: both adapters need exactly one field out of
 * an untrusted `unknown`, and the narrowing that does it safely is six lines
 * nobody should write twice. An array is refused deliberately — `["event"]` has
 * an `event` property in JavaScript's eyes and must not read as an event name.
 */
export function webhookEventName(payload: unknown): string {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return "unknown";
  const event = (payload as { event?: unknown }).event;
  return typeof event === "string" && event !== "" ? event : "unknown";
}
