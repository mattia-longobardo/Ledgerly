import { oauthProvider } from "@better-auth/oauth-provider";
import { hash, verify } from "@node-rs/argon2";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { admin, genericOAuth, jwt, twoFactor } from "better-auth/plugins";
import { getDb } from "../../db/client";
import * as tables from "../../db/tables";
import { readEnv } from "../../env";
import { type OidcConfig, oidcFromEnv } from "../../settings/config";
import { hasSsoAccount } from "../accounts";
import { authLogger, redactForLog } from "../logger";
import { MAX_NAME_LENGTH, nameSchema } from "../name-policy";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  API_SCOPES,
  CONSENT_PAGE,
  DCR_SCOPES,
  issuerFor,
  LOGIN_PAGE,
  OAUTH_SCOPES,
  REFRESH_TOKEN_TTL_SECONDS,
  registrationApplicationType,
  registrationRedirectsAllowed,
  registrationScope,
  resourceFor,
} from "../oauth";
import { revokeUserOAuthTokens } from "../oauth-grants";
import { accessControl, roles } from "../permissions";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "../password-policy";
import { OIDC_PROVIDER_ID } from "../provider";
import {
  ARGON2,
  ID_TOKEN_PATHS,
  REGISTER_RATE_LIMIT,
  RESET_PASSWORD_TOKEN_TTL_SECONDS,
  SERVER_ONLY_OAUTH_PATHS,
  SESSION_OAUTH_PATHS,
  TRUST_DEVICE_DAYS,
  TWO_FACTOR_RATE_LIMIT,
  applyOidcRole,
  noUsersYet,
  sendPasswordResetEmail,
  setupPending,
  withDiscoveryDeadline,
} from "./settings";

/**
 * `oidc` is the *effective* identity provider (`oidcConfig()`): the saved settings when an admin
 * has filled Admin › Server, the environment otherwise. It is passed in rather than read here so
 * that this function stays synchronous and the scripts can build an instance without a settings
 * row (plan F8 §3.4.3).
 */
export function createAuth({
  withNextCookies,
  oidc = oidcFromEnv(),
}: {
  withNextCookies: boolean;
  oidc?: OidcConfig;
}) {
  const env = readEnv();
  return betterAuth({
    appName: "Ledgerly",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.BETTER_AUTH_URL],
    database: drizzleAdapter(getDb(), { provider: "pg", schema: tables }),
    logger: authLogger,
    user: {
      modelName: "users",
      // Sign-up is closed: users come from Authentik, from an accepted invitation or from the
      // server-side bootstrap (`auth.api.createUser`, method "admin"). Nothing else creates users.
      validateUserInfo: async ({ source }) => {
        if (source.action !== "create-user") return;
        if (source.method === "oauth" || source.method === "admin") return;
        return { error: "invitation_required", errorDescription: "An invitation is required to sign up." };
      },
    },
    session: { modelName: "sessions", expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    account: {
      modelName: "authAccounts",
      // An SSO identity signs in only as the user it is already linked to: a matching email is not
      // proof of ownership (an Authentik user could otherwise set another user's address).
      accountLinking: { disableImplicitLinking: true },
      encryptOAuthTokens: true,
    },
    // The reset-password verification identifier embeds the raw token (`reset-password:<token>`);
    // hashing it before storage keeps the token itself out of the database, like invitation tokens.
    verification: { modelName: "verifications", storeIdentifier: "hashed" },
    advanced: {
      // Postgres generates every id (`DEFAULT uuidv7()`, spec §4.3); Better Auth inserts none.
      database: { generateId: false },
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"], trustedProxies: env.TRUSTED_PROXY_IPS },
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
      autoSignIn: true,
      revokeSessionsOnPasswordReset: true,
      // The OAuth refresh tokens go with the sessions (PERS-49 SEC-05): a stolen password reset
      // must not leave a connected app holding a 30-day way back in.
      onPasswordReset: async ({ user }) => revokeUserOAuthTokens(user.id),
      password: {
        hash: (password) => hash(password, ARGON2),
        verify: ({ hash: stored, password }) => verify(stored, password),
      },
      resetPasswordTokenExpiresIn: RESET_PASSWORD_TOKEN_TTL_SECONDS,
      // Fire and forget: the response time must not reveal whether the address exists or how it signs in.
      sendResetPassword: async ({ user, url }) => {
        void sendPasswordResetEmail(user, url).catch((error: unknown) => {
          console.error("[auth] password reset email failed", redactForLog(error));
        });
      },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "rateLimits",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 60 * 15, max: 3 },
        "/change-password": { window: 60, max: 5 },
        "/two-factor/verify-totp": TWO_FACTOR_RATE_LIMIT,
        "/two-factor/verify-backup-code": TWO_FACTOR_RATE_LIMIT,
        "/two-factor/enable": TWO_FACTOR_RATE_LIMIT,
        "/two-factor/disable": TWO_FACTOR_RATE_LIMIT,
        "/two-factor/generate-backup-codes": TWO_FACTOR_RATE_LIMIT,
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // `ctx.request` exists only for a call that came over HTTP: `auth.api.*` from a Server
        // Action has none, and that is the one way the client endpoints may be reached.
        if (SERVER_ONLY_OAUTH_PATHS.has(ctx.path) && ctx.request) {
          throw new APIError("FORBIDDEN", { code: "SERVER_ONLY", message: "Not available over HTTP." });
        }
        // Self-registration is for public clients only (D3): a confidential client comes from
        // Settings › Security, tied to the person who made it.
        if (ctx.path === "/oauth2/register" && ctx.request) {
          const method = (ctx.body as { token_endpoint_auth_method?: unknown } | undefined)
            ?.token_endpoint_auth_method;
          if (method !== "none") {
            throw new APIError("BAD_REQUEST", {
              error: "invalid_client_metadata",
              error_description: "Only public clients (token_endpoint_auth_method=none) may register.",
            });
          }
          // Loopback or allowlisted redirects only, and never more than the read-only MCP
          // (PERS-49 SEC-01): the consent screen is the last line, not the only one.
          if (!registrationRedirectsAllowed(ctx.body)) {
            throw new APIError("BAD_REQUEST", {
              error: "invalid_redirect_uri",
              error_description: "Only loopback http redirect URIs or an allowlisted callback may register.",
            });
          }
          const applicationType = registrationApplicationType(ctx.body);
          return {
            context: {
              body: {
                ...ctx.body,
                scope: registrationScope(ctx.body),
                ...(applicationType ? { application_type: applicationType } : {}),
              },
            },
          };
        }
        // A session still owing its TOTP setup opens nothing but the setup page (D2), and the
        // authorize endpoint is no exception: otherwise a token would be the way around it.
        if (SESSION_OAUTH_PATHS.has(ctx.path)) {
          const session = await getSessionFromCtx(ctx);
          if (session && (await setupPending(session.user))) {
            throw new APIError("FORBIDDEN", {
              code: "TWO_FACTOR_SETUP_REQUIRED",
              message: "Set up two-factor authentication first.",
            });
          }
        }
        if (ID_TOKEN_PATHS.has(ctx.path) && ctx.body?.idToken) {
          throw new APIError("FORBIDDEN", {
            code: "ID_TOKEN_SIGN_IN_DISABLED",
            message: "Sign in through the identity provider's login page.",
          });
        }
        // The React form (updateNameAction) hides itself and refuses server-side while SSO is
        // linked, and trims/bounds the name the same way; this closes the same door for a request
        // that calls POST /update-user directly, bypassing that action (P9, spec §5.1).
        if (
          ctx.path === "/update-user" &&
          ctx.body &&
          typeof ctx.body === "object" &&
          "name" in ctx.body &&
          ctx.body.name !== undefined
        ) {
          const session = await getSessionFromCtx(ctx);
          if (session && (await hasSsoAccount(session.user.id))) {
            throw new APIError("FORBIDDEN", {
              code: "NAME_MANAGED_BY_SSO",
              message: "The name is managed by Authentik while SSO is linked.",
            });
          }
          const parsedName = nameSchema.safeParse(ctx.body.name);
          if (!parsedName.success) {
            throw new APIError("BAD_REQUEST", {
              code: "INVALID_NAME",
              message: `Enter a name between 1 and ${MAX_NAME_LENGTH} characters.`,
            });
          }
          return { context: { body: { name: parsedName.data } } };
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => ((await noUsersYet()) ? { data: { ...user, role: "admin" } } : undefined),
        },
      },
      account: {
        create: { after: applyOidcRole },
        update: { after: applyOidcRole },
      },
    },
    plugins: [
      admin({ defaultRole: "user", adminRoles: ["admin"], ac: accessControl, roles }),
      // TOTP for password accounts only: the plugin challenges /sign-in/email, never an Authentik
      // callback, so SSO users keep Authentik's own second factor (docs/auth-design.md D2).
      // Secret and recovery codes are stored encrypted with BETTER_AUTH_SECRET.
      twoFactor({
        issuer: "Ledgerly",
        trustDeviceMaxAge: TRUST_DEVICE_DAYS * 24 * 60 * 60,
        backupCodeOptions: { amount: 10, storeBackupCodes: "encrypted" },
        schema: { twoFactor: { modelName: "twoFactors" } },
      }),
      // Signs the access tokens; its keys live in `jwks`, the private half encrypted. The issuer is
      // pinned so a token's `iss` is the one the metadata advertises (D3).
      jwt({
        disableSettingJwtHeader: true,
        jwt: { issuer: issuerFor(env.BETTER_AUTH_URL) },
        schema: { jwks: { modelName: "jwks" } },
      }),
      // Ledgerly as Authorization Server for /api/v1 and /api/mcp (docs/auth-design.md D3).
      oauthProvider({
        loginPage: LOGIN_PAGE,
        consentPage: CONSENT_PAGE,
        scopes: [...OAUTH_SCOPES],
        grantTypes: ["authorization_code", "refresh_token", "client_credentials"],
        resources: [
          {
            identifier: resourceFor(env.BETTER_AUTH_URL, "api"),
            name: "Ledgerly API",
            allowedScopes: [...API_SCOPES],
          },
          {
            identifier: resourceFor(env.BETTER_AUTH_URL, "mcp"),
            name: "Ledgerly MCP",
            allowedScopes: [...API_SCOPES, "offline_access"],
          },
        ],
        // The configuration is the source of truth: a resource edited here is edited in the table.
        resourceSeedMode: "overwrite",
        accessTokenExpiresIn: ACCESS_TOKEN_TTL_SECONDS,
        m2mAccessTokenExpiresIn: ACCESS_TOKEN_TTL_SECONDS,
        refreshTokenExpiresIn: REFRESH_TOKEN_TTL_SECONDS,
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        // Every client is linked to the MCP (the plugin enforces the link per client); a
        // self-registered one to nothing else, so a token it gets can never carry `aud=/api/v1`
        // (PERS-49 SEC-01). A Client API names `/api/v1` itself (api-clients.ts).
        clientRegistrationDefaultResources: [resourceFor(env.BETTER_AUTH_URL, "mcp")],
        clientRegistrationAllowedResources: [resourceFor(env.BETTER_AUTH_URL, "mcp")],
        clientRegistrationDefaultScopes: ["read"],
        clientRegistrationAllowedScopes: [...DCR_SCOPES],
        storeClientSecret: "hashed",
        storeTokens: "hashed",
        // Reached only through `auth.api` (the hook above refuses HTTP), by a person who is past
        // the TOTP setup: their own clients, with the scopes Settings › Security offers.
        clientPrivileges: async ({ user }) => (user ? !(await setupPending(user)) : false),
        rateLimit: { register: REGISTER_RATE_LIMIT },
        schema: {
          oauthClient: { modelName: "oauthClients" },
          oauthResource: { modelName: "oauthResources" },
          oauthClientResource: { modelName: "oauthClientResources" },
          oauthRefreshToken: { modelName: "oauthRefreshTokens" },
          oauthAccessToken: { modelName: "oauthAccessTokens" },
          oauthConsent: { modelName: "oauthConsents" },
          oauthClientAssertion: { modelName: "oauthClientAssertions" },
        },
      }),
      withDiscoveryDeadline(
        genericOAuth({
          config: [
            {
              providerId: OIDC_PROVIDER_ID,
              name: "Authentik",
              clientId: oidc.clientId,
              clientSecret: oidc.clientSecret,
              discoveryUrl: oidc.discoveryUrl,
              scopes: ["openid", "profile", "email"],
              pkce: true,
              requireIdTokenVerification: true,
              overrideUserInfo: true,
              mapProfileToUser: (profile) => ({
                name:
                  (profile.name as string | undefined) ??
                  (profile.preferred_username as string | undefined) ??
                  (profile.email as string),
              }),
            },
          ],
        }),
      ),
      ...(withNextCookies ? [nextCookies()] : []),
    ],
  });
}
