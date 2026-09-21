import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * The whole error vocabulary of `/api/v1`. A body is `{"error":"<code>"}` and nothing else: the
 * caller is a script, so a code it can branch on is worth more than a sentence, and a sentence
 * would have to exist in two languages (`messages/*.json`) for no reader.
 */
export type ApiErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "invalid"
  | "too_large"
  | "unsupported_format"
  | "rate_limited"
  | "server_error";

const STATUS: Record<ApiErrorCode, ContentfulStatusCode> = {
  unauthorized: 401,
  // The token is real but lacks the scope: a different fact from "who are you", and a script
  // that gets 403 knows to mint a token with another scope rather than to check its secret.
  forbidden: 403,
  not_found: 404,
  invalid: 400,
  too_large: 413,
  unsupported_format: 415,
  rate_limited: 429,
  server_error: 500,
};

export function fail(c: Context, code: ApiErrorCode) {
  return c.json({ error: code }, STATUS[code]);
}
