import "server-only";

/**
 * "Test connection" for Authentik (design, row 884): is the discovery document there, and does it
 * describe the issuer that was typed?
 *
 * HTTP only, like {@link ../settings/llm-probe}: no database handle, no credential. The client
 * secret is deliberately *not* used — a discovery document is public, and an admin pressing the
 * button wants to know whether the URL is right, which is the mistake that actually happens. A
 * wrong secret shows up at the first sign-in, where it belongs, and probing it would mean starting
 * an authorization flow the admin never asked for.
 *
 * Nothing the provider sends comes back: the verdict is a message key, never its body (spec §5.4).
 */

export const OIDC_PROBE_TIMEOUT_MS = 8_000;

export type OidcProbeOutcome =
  | "ok"
  /** Reached, but the document is not JSON or has no `issuer`/`authorization_endpoint`. */
  | "invalidDocument"
  /** Reached, well formed, but it names a different issuer than the one saved. */
  | "issuerMismatch"
  | "unreachable";

export interface OidcProbeResult {
  outcome: OidcProbeOutcome;
  checkedAt: Date;
}

/** The two fields Better Auth cannot start a sign-in without, plus the issuer it verifies. */
interface Discovery {
  issuer?: unknown;
  authorization_endpoint?: unknown;
  token_endpoint?: unknown;
}

/** An issuer compares equal to itself with or without its trailing slash (RFC 8414 §3). */
function sameIssuer(a: string, b: string): boolean {
  return a.replace(/\/+$/, "") === b.replace(/\/+$/, "");
}

export async function probeOidc(
  config: { issuer: string; discoveryUrl: string },
  deps: { fetch: typeof fetch; now?: () => Date } = { fetch: globalThis.fetch },
): Promise<OidcProbeResult> {
  const checkedAt = (deps.now ?? (() => new Date()))();
  let document: Discovery;
  try {
    const response = await deps.fetch(config.discoveryUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(OIDC_PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return { outcome: "unreachable", checkedAt };
    document = (await response.json()) as Discovery;
  } catch {
    // A refused connection, a DNS failure, the timeout above, or a body that is not JSON. Which
    // one it was stays here: the reason's text quotes the request.
    return { outcome: "unreachable", checkedAt };
  }
  if (
    typeof document?.issuer !== "string" ||
    typeof document.authorization_endpoint !== "string" ||
    typeof document.token_endpoint !== "string"
  ) {
    return { outcome: "invalidDocument", checkedAt };
  }
  if (!sameIssuer(document.issuer, config.issuer)) return { outcome: "issuerMismatch", checkedAt };
  return { outcome: "ok", checkedAt };
}
