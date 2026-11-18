// No `server-only`: the proxy and client components import it too.

/** Better Auth provider id of the Authentik login; also the last segment of its callback URL. */
export const OIDC_PROVIDER_ID = "authentik";

/** The identity provider's discovery URL, or null when unset or malformed (the build has no env). */
export function identityProviderUrl(): URL | null {
  try {
    return new URL(process.env.OIDC_DISCOVERY_URL ?? "");
  } catch {
    return null;
  }
}
