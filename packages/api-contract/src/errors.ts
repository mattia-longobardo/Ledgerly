// The error vocabulary of `/api/v1` (rewrite plan R2, 10-modularity.md §10.2): one code per fact a
// caller can branch on. A body is `{"error":"<code>"}`, plus `reason` where a route names the
// refusal of its use case (a `TaxonomyError`, an `AdminError` code): the caller is a script, so a code
// is worth more than a sentence that would have to exist in two languages.
import { z } from "zod";

/** Every code; a new code is an addition to this list, never a rename. */
const API_ERROR_CODES = [
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "invalid",
  "too_large",
  "unsupported_format",
  "rate_limited",
  "server_error",
  "unavailable",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** The HTTP status of each code. */
export const API_ERRORS: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  // The token is real but lacks the scope: a client that gets 403 mints a token with another scope.
  forbidden: 403,
  not_found: 404,
  // The request is well formed but the state refuses it (the last admin, a provider not connected).
  conflict: 409,
  invalid: 400,
  too_large: 413,
  unsupported_format: 415,
  rate_limited: 429,
  server_error: 500,
  // The server cannot compute the answer now (a check of the plugins): try again later.
  unavailable: 503,
};

/** The body of every answer that is not a 2xx. */
export const errorBody = z.object({
  error: z.enum(API_ERROR_CODES),
  reason: z.string().optional(),
  /** `iban_exists` and `iban_archived`: the name of the account that has the IBAN, never the IBAN (H45). */
  other: z.string().optional(),
});
