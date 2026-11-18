/**
 * The errors of contract v1: a closed list of codes, each with one HTTP status. A plugin never
 * sends the provider's own message — the body of a failure is `{ "error": { "code": … } }` and
 * nothing else (docs/design/rewrite-plan/04-now.md §4.1, "Errori").
 */
import { z } from "zod";

export const PLUGIN_ERROR_CODES = [
  /** The shared secret of the core is missing or wrong. */
  "unauthorized",
  /** The body is not what the contract says. */
  "invalid_request",
  /** A credential is not in the format the provider issues (e.g. not a private key). */
  "key_format",
  /** The provider refuses the credentials. */
  "auth",
  /** The access the person gave has ended, or was closed. */
  "consent_expired",
  /** The provider, or the institution behind it, accepts no more calls for now. */
  "rate_limited",
  /** The provider or the institution did not answer, or answered with a failure of its own. */
  "provider_down",
  /** The institution the person chose cannot be used now. */
  "institution_unavailable",
  /** The provider answered with something the plugin cannot read. */
  "invalid_data",
  /** Anything else. */
  "failed",
] as const;
export type PluginErrorCode = (typeof PLUGIN_ERROR_CODES)[number];

export const PLUGIN_ERROR_STATUS: Record<PluginErrorCode, number> = {
  unauthorized: 401,
  invalid_request: 400,
  key_format: 400,
  auth: 403,
  consent_expired: 409,
  rate_limited: 429,
  provider_down: 502,
  institution_unavailable: 503,
  invalid_data: 502,
  failed: 500,
};

export const errorBodySchema = z.object({
  error: z.object({
    code: z.enum(PLUGIN_ERROR_CODES),
    /** Seconds to wait before the next call, when the provider said so. */
    retryAfterSeconds: z.number().int().min(0).max(604_800).optional(),
  }),
});
export type PluginErrorBody = z.infer<typeof errorBodySchema>;
