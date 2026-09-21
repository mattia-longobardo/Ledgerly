import { z } from "zod";

/**
 * The identity provider's settings (spec §5.1), as pure rules: what an admin may type, and how the
 * issuer they type relates to the discovery document Better Auth actually fetches.
 *
 * The design asks for an **issuer** ("Issuer URL", `https://auth.example/application/o/app/`) while
 * `genericOAuth` is configured with a **discovery URL**, and `.env.homelab` holds the latter. One
 * of the two has to be derived from the other; the issuer is what an admin reads off Authentik's
 * provider page, so it is what is stored, and the discovery URL is computed from it here.
 */

/** Where an OpenID provider publishes its metadata, relative to the issuer (RFC 8414 §3). */
export const DISCOVERY_PATH = ".well-known/openid-configuration";

/** An issuer with the trailing slash `new URL(path, base)` needs to keep the last path segment. */
function withTrailingSlash(issuer: string): string {
  return issuer.endsWith("/") ? issuer : `${issuer}/`;
}

/** The discovery document of an issuer: `<issuer>/.well-known/openid-configuration`. */
export function discoveryUrlFor(issuer: string): string {
  return new URL(DISCOVERY_PATH, withTrailingSlash(issuer.trim())).toString();
}

/**
 * The inverse, for the initial value read from `OIDC_DISCOVERY_URL`: the environment names the
 * document, the screen names the issuer. A URL that does not end in the well-known path is already
 * an issuer (some deployments configure it that way) and comes back unchanged but for its slash.
 */
export function issuerFromDiscoveryUrl(url: string): string {
  const trimmed = url.trim();
  const suffix = `/${DISCOVERY_PATH}`;
  const withoutQuery = trimmed.split(/[?#]/)[0];
  return withoutQuery.endsWith(suffix)
    ? withTrailingSlash(withoutQuery.slice(0, -suffix.length))
    : withTrailingSlash(withoutQuery);
}

/**
 * Whether the two issuers are the same provider. Compared as discovery URLs so a trailing slash
 * typed one time and not the next is not mistaken for a new identity provider — which would sign
 * every user out (spec §5.1).
 */
export function issuerChanged(before: string | null, after: string): boolean {
  if (before === null) return false;
  try {
    return discoveryUrlFor(before) !== discoveryUrlFor(after);
  } catch {
    return before.trim() !== after.trim();
  }
}

/** The origin a browser would be sent to, for the CSP note on the card; null when unparseable. */
export function issuerOrigin(issuer: string): string | null {
  try {
    return new URL(issuer.trim()).origin;
  } catch {
    return null;
  }
}

export const MAX_OIDC_FIELD = 200;

/**
 * What the Authentik card accepts. The client secret is optional exactly like the LLM key: an
 * empty field keeps the one already sealed, and there is no way to read it back.
 */
export const oidcInputSchema = z.object({
  issuer: z.url().max(MAX_OIDC_FIELD),
  clientId: z.string().trim().min(1).max(MAX_OIDC_FIELD),
  clientSecret: z.string().max(MAX_OIDC_FIELD),
  adminGroup: z.string().trim().min(1).max(MAX_OIDC_FIELD),
});

export type OidcInput = z.infer<typeof oidcInputSchema>;
