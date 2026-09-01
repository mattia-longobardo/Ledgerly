import NextAuth, { type NextAuthConfig, type Profile } from "next-auth";
import type { OIDCConfig } from "next-auth/providers";
import type { JWT } from "@auth/core/jwt";
import { env } from "@/lib/env";

declare module "next-auth" {
  interface Session {
    /**
     * Set when the session must not be trusted: the allowlist rejected the
     * subject, or the refresh-token rotation failed. Consumers treat either as
     * "not signed in".
     */
    error?: "AccessDenied" | "RefreshAccessTokenError";
  }
}

export const PROVIDER_ID = "authentik";

const SESSION_MAX_AGE_S = 60 * 60 * 24 * 7;
const SESSION_UPDATE_AGE_S = 60 * 60 * 24;
/** Refresh a little early so an in-flight request never uses an expired token. */
const ACCESS_TOKEN_SKEW_S = 60;
const FALLBACK_ACCESS_TOKEN_TTL_S = 600;

function nowS(): number {
  return Math.floor(Date.now() / 1000);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * `__Host-` is only legal on a Secure cookie, so a plain-HTTP dev origin has to
 * fall back to the unprefixed name rather than silently dropping the session.
 */
export function useSecureCookies(): boolean {
  return new URL(env().AUTH_URL).protocol === "https:";
}

export function sessionCookieName(): string {
  return useSecureCookies() ? "__Host-authjs.session-token" : "authjs.session-token";
}

export interface OidcDiscovery {
  token_endpoint: string;
  end_session_endpoint?: string;
}

let discoveryCache: Promise<OidcDiscovery> | null = null;

async function fetchDiscovery(): Promise<OidcDiscovery> {
  const base = env().OIDC_ISSUER.replace(/\/+$/, "");
  const res = await fetch(`${base}/.well-known/openid-configuration`, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`OIDC discovery failed with status ${res.status}`);
  const doc: unknown = await res.json();
  if (typeof doc !== "object" || doc === null) throw new Error("OIDC discovery returned a non-object");
  const record = doc as Record<string, unknown>;
  const tokenEndpoint = asString(record.token_endpoint);
  if (!tokenEndpoint) throw new Error("OIDC discovery document has no token_endpoint");
  const endSession = asString(record.end_session_endpoint);
  return endSession ? { token_endpoint: tokenEndpoint, end_session_endpoint: endSession } : { token_endpoint: tokenEndpoint };
}

/** Cached for the process lifetime; a failed lookup is never cached. */
export function discoverOidc(): Promise<OidcDiscovery> {
  discoveryCache ??= fetchDiscovery().catch((err: unknown) => {
    discoveryCache = null;
    throw err;
  });
  return discoveryCache;
}

function logAuthEvent(event: string, fields: Record<string, string | number | boolean>): void {
  console.warn(JSON.stringify({ ts: new Date().toISOString(), level: "warn", event, ...fields }));
}

interface RefreshResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  id_token?: string;
}

function parseRefreshResponse(body: unknown): RefreshResponse | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  const accessToken = asString(record.access_token);
  if (!accessToken) return null;
  return {
    access_token: accessToken,
    expires_in: asNumber(record.expires_in),
    refresh_token: asString(record.refresh_token),
    id_token: asString(record.id_token),
  };
}

async function refreshAccessToken(token: JWT): Promise<JWT> {
  const refreshToken = asString(token.refresh_token);
  if (!refreshToken) {
    logAuthEvent("oidc_refresh_failed", { reason: "no_refresh_token" });
    return { ...token, error: "RefreshAccessTokenError" };
  }

  try {
    const { token_endpoint } = await discoverOidc();
    const res = await fetch(token_endpoint, {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: env().OIDC_CLIENT_ID,
        client_secret: env().OIDC_CLIENT_SECRET,
      }),
    });
    const parsed = res.ok ? parseRefreshResponse(await res.json().catch(() => null)) : null;
    if (!parsed) {
      logAuthEvent("oidc_refresh_failed", { reason: "token_endpoint_rejected", status: res.status });
      return { ...token, error: "RefreshAccessTokenError" };
    }

    const next: JWT = {
      ...token,
      access_token: parsed.access_token,
      expires_at: nowS() + (parsed.expires_in ?? FALLBACK_ACCESS_TOKEN_TTL_S),
      // Authentik rotates refresh tokens; keep the old one if it withheld a new one.
      refresh_token: parsed.refresh_token ?? refreshToken,
    };
    if (parsed.id_token) next.id_token = parsed.id_token;
    delete next.error;
    return next;
  } catch (err) {
    logAuthEvent("oidc_refresh_failed", {
      reason: "transport_error",
      message: err instanceof Error ? err.name : "unknown",
    });
    return { ...token, error: "RefreshAccessTokenError" };
  }
}

function authentikProvider(): OIDCConfig<Profile> {
  return {
    id: PROVIDER_ID,
    name: "Authentik",
    type: "oidc",
    issuer: env().OIDC_ISSUER,
    clientId: env().OIDC_CLIENT_ID,
    clientSecret: env().OIDC_CLIENT_SECRET,
    checks: ["pkce", "state", "nonce"],
    authorization: { params: { scope: "openid profile email offline_access" } },
  };
}

function buildConfig(): NextAuthConfig {
  const secure = useSecureCookies();

  return {
    trustHost: true,
    providers: [authentikProvider()],
    session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_S, updateAge: SESSION_UPDATE_AGE_S },
    useSecureCookies: secure,
    cookies: {
      sessionToken: {
        name: sessionCookieName(),
        options: { httpOnly: true, sameSite: "lax", path: "/", secure },
      },
    },
    pages: { signIn: "/signin", error: "/signin" },
    callbacks: {
      signIn({ account, profile }) {
        if (account?.provider !== PROVIDER_ID) {
          logAuthEvent("signin_denied", { reason: "unexpected_provider", provider: account?.provider ?? "none" });
          return false;
        }
        const sub = asString(profile?.sub);
        if (!sub || sub !== env().AUTHORIZED_SUB) {
          logAuthEvent("signin_denied", { reason: "sub_not_allowlisted", sub: sub ?? "none" });
          return false;
        }
        // Email is corroborating evidence only — the sub is the identity.
        const allowedEmail = env().AUTHORIZED_EMAIL;
        const presentedEmail = asString(profile?.email);
        if (allowedEmail && presentedEmail && presentedEmail.toLowerCase() !== allowedEmail.toLowerCase()) {
          logAuthEvent("signin_denied", { reason: "email_mismatch", sub });
          return false;
        }
        return true;
      },

      async jwt({ token, account, profile }) {
        if (account) {
          const expiresAt =
            asNumber(account.expires_at) ??
            nowS() + (asNumber(account.expires_in) ?? FALLBACK_ACCESS_TOKEN_TTL_S);
          const fresh: JWT = {
            ...token,
            sub: asString(profile?.sub) ?? token.sub,
            access_token: account.access_token,
            refresh_token: account.refresh_token,
            id_token: account.id_token,
            expires_at: expiresAt,
          };
          delete fresh.error;
          return fresh;
        }

        const expiresAt = asNumber(token.expires_at);
        if (expiresAt !== undefined && nowS() < expiresAt - ACCESS_TOKEN_SKEW_S) return token;
        return refreshAccessToken(token);
      },

      // Layer 2 of the single-user enforcement: the allowlist is re-checked on
      // every session read, not only at sign-in.
      session({ session, token }) {
        const sub = asString(token.sub);
        if (!sub || sub !== env().AUTHORIZED_SUB) {
          logAuthEvent("session_denied", { reason: "sub_not_allowlisted", sub: sub ?? "none" });
          return { expires: new Date(0).toISOString(), error: "AccessDenied" };
        }
        if (asString(token.error)) {
          return { expires: new Date(0).toISOString(), error: "RefreshAccessTokenError" };
        }
        return {
          ...session,
          user: {
            ...session.user,
            id: sub,
            email: asString(token.email) ?? session.user?.email ?? null,
            name: asString(token.name) ?? session.user?.name ?? null,
          },
        };
      },
    },
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth(() => buildConfig());
