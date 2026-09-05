const REDACTED = "[redacted]";

/**
 * A provider's `testConnection` (or any adapter call) hands back arbitrary
 * text, and an HTTP client that folds a URL or a header into its error or
 * status message can put the connection's own credential into it. Every call
 * site that persists such a message into a column the owner's Settings UI
 * renders — `sync_runs.error`, `integration_connections.last_error`, and the
 * audit payloads built from either — must close that leak before the write.
 *
 * Only the exact values the caller was handed are redacted. Guessing at
 * credential-shaped substrings would either miss a credential in an
 * unexpected shape or redact something that was never secret; replacing known
 * values is the one rule that cannot do either.
 *
 * This lives here rather than in `application/run-sync.ts` (its original
 * home) because it is framework, provider-neutral, and needed by every write
 * site that holds a credential and a provider-produced message — not just
 * sync runs.
 */
export function redactCredentials(message: string, credentials: Record<string, string>): string {
  let redacted = message;
  for (const value of Object.values(credentials)) {
    if (!value) continue;
    redacted = redacted.split(value).join(REDACTED);
  }
  return redacted;
}
