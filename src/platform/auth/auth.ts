import "server-only";
import { oauthProvider } from "@better-auth/oauth-provider";
import { hash, verify } from "@node-rs/argon2";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { admin, genericOAuth, jwt, twoFactor } from "better-auth/plugins";
import { count, eq } from "drizzle-orm";
import { getPreferences } from "@/modules/users/service";
import { getDb } from "@/platform/db/client";
import * as tables from "@/platform/db/tables";
import { readEnv } from "@/platform/env";
import { sendMail } from "@/platform/mail";
import {
  mailAllowed,
  OIDC_PROVIDER,
  type OidcConfig,
  oidcConfig,
  oidcFromEnv,
  SETTINGS_REVALIDATE_MS,
  settingsStamp,
} from "@/platform/settings/config";
import { hasPasswordAccount, hasSsoAccount } from "./accounts";
import { passwordResetEmail } from "./emails";
import { authLogger, redactForLog } from "./logger";
import { MAX_NAME_LENGTH, nameSchema } from "./name-policy";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  API_SCOPES,
  CONSENT_PAGE,
  issuerFor,
  LOGIN_PAGE,
  OAUTH_SCOPES,
  REFRESH_TOKEN_TTL_SECONDS,
  registrationApplicationType,
  resourceFor,
} from "./oauth";
import { accessControl, roles } from "./permissions";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "./password-policy";
import { OIDC_PROVIDER_ID } from "./provider";
import { roleFromIdToken } from "./roles";
import { users } from "./schema";
import { twoFactorSetupRequired } from "./two-factor-policy";

export const RESET_PASSWORD_TOKEN_TTL_SECONDS = 60 * 60;

// OWASP argon2id parameters; @node-rs/argon2 uses argon2id by default.
const ARGON2 = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

/** Endpoints that would accept a bare ID token instead of the redirect flow (PKCE, state, nonce). */
const ID_TOKEN_PATHS = new Set(["/sign-in/social", "/link-social"]);

const DISCOVERY_TIMEOUT_MS = 5_000;
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 5 * 60_000;

export async function applyOidcRole(account: {
  providerId: string;
  userId: string;
  idToken?: string | null;
}) {
  if (account.providerId !== OIDC_PROVIDER_ID || !account.idToken) return;
  // The group is read fresh, not captured when the instance was built: an admin who corrects it
  // in Admin › Server means the next sign-in, not the next worker restart.
  const role = roleFromIdToken(account.idToken, (await oidcConfig()).adminGroup);
  if (role) await getDb().update(users).set({ role }).where(eq(users.id, account.userId));
}

/**
 * Only a password account gets the link: Better Auth's reset endpoint would otherwise create a
 * password for an Authentik-only user, a way around Authentik's own sign-in policy (such as 2FA).
 * Nothing is logged when no email goes out, so the logs do not tell the two cases apart either.
 */
async function sendPasswordResetEmail(user: { id: string; email: string }, url: string): Promise<void> {
  // "Invitations & resets", off, means the reset link does not leave either (plan F8 §3.4.6):
  // it is the one switch that can lock a person out, and the SMTP card says so beside it.
  if (!(await mailAllowed("invitations"))) return;
  if (!(await hasPasswordAccount(user.id))) return;
  const { locale } = await getPreferences({ userId: user.id });
  const hours = RESET_PASSWORD_TOKEN_TTL_SECONDS / 3600;
  await sendMail({ to: user.email, ...passwordResetEmail(url, hours, locale) });
}

/** The TOTP setup still owed under TWO_FACTOR_POLICY=required (see `session.ts`). */
async function setupPending(user: { id: string; twoFactorEnabled?: boolean | null }): Promise<boolean> {
  const policy = readEnv().TWO_FACTOR_POLICY;
  const twoFactorEnabled = user.twoFactorEnabled === true;
  if (policy !== "required" || twoFactorEnabled) return false;
  return twoFactorSetupRequired({ policy, twoFactorEnabled, hasPassword: await hasPasswordAccount(user.id) });
}

async function noUsersYet(): Promise<boolean> {
  const [row] = await getDb().select({ n: count() }).from(users);
  return (row?.n ?? 0) === 0;
}

type OidcPlugin = ReturnType<typeof genericOAuth>;

/** How long "Trust this device" skips the TOTP prompt (docs/auth-design.md D2). */
export const TRUST_DEVICE_DAYS = 30;

/**
 * Every endpoint that checks a second factor or changes it. Five a minute per client, on top of the
 * plugin's own limits: five wrong codes end a sign-in challenge, ten in a row lock the account's
 * second factor for 15 minutes (Better Auth `accountLockout` defaults).
 */
const TWO_FACTOR_RATE_LIMIT = { window: 60, max: 5 } as const;

/**
 * The client-management endpoints of the OAuth provider. A person manages their "Client API" in
 * Settings › Security, whose Server Actions call these through `auth.api`; over HTTP they answer
 * 403, so a client can only ever be created with the scopes and grant that screen allows.
 */
const SERVER_ONLY_OAUTH_PATHS = new Set([
  "/oauth2/create-client",
  "/oauth2/update-client",
  "/oauth2/delete-client",
  "/oauth2/get-client",
  "/oauth2/get-clients",
  "/oauth2/client/rotate-secret",
  "/oauth2/get-consent",
  "/oauth2/get-consents",
  "/oauth2/update-consent",
  "/oauth2/delete-consent",
]);

/** The endpoints that act on a person's session to hand out a token. */
const SESSION_OAUTH_PATHS = new Set(["/oauth2/authorize", "/oauth2/consent", "/oauth2/continue"]);

/** RFC 7591 registration: open (MCP clients register themselves), a few a minute per client. */
const REGISTER_RATE_LIMIT = { window: 60, max: 5 } as const;

/**
 * genericOAuth fetches the discovery document once, while Better Auth initializes, and 1.7.14
 * still gives that startup fetch no timeout or signal (only its per-request retry has one). Past
 * the deadline the provider is left out and marked pending, exactly as on a failed fetch: the
 * plugin retries discovery on the next Authentik sign-in, and getAuth() rebuilds the instance after
 * its backoff. The abandoned fetch settles on its own.
 */
function withDiscoveryDeadline(plugin: OidcPlugin): OidcPlugin {
  return {
    ...plugin,
    init: async (ctx) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<Awaited<ReturnType<OidcPlugin["init"]>>>((resolve) => {
        timer = setTimeout(() => {
          ctx.logger.error(`Discovery for "${OIDC_PROVIDER_ID}" timed out after ${DISCOVERY_TIMEOUT_MS} ms`);
          resolve({
            context: {
              socialProviders: ctx.socialProviders,
              genericOAuthPendingDiscovery: new Map(
                plugin.options.config.map((config) => [config.providerId, { config }]),
              ),
            },
          });
        }, DISCOVERY_TIMEOUT_MS);
      });
      try {
        return await Promise.race([plugin.init(ctx), deadline]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

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
          const applicationType = registrationApplicationType(ctx.body);
          if (applicationType)
            return { context: { body: { ...ctx.body, application_type: applicationType } } };
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
        // A registered client is linked to both resources (the plugin enforces the link per
        // client); what it may actually do is still what the person consents to.
        clientRegistrationDefaultResources: [
          resourceFor(env.BETTER_AUTH_URL, "api"),
          resourceFor(env.BETTER_AUTH_URL, "mcp"),
        ],
        clientRegistrationAllowedResources: [
          resourceFor(env.BETTER_AUTH_URL, "api"),
          resourceFor(env.BETTER_AUTH_URL, "mcp"),
        ],
        clientRegistrationDefaultScopes: ["read"],
        clientRegistrationAllowedScopes: [...API_SCOPES, "offline_access"],
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

export type Auth = ReturnType<typeof createAuth>;

interface CachedAuth {
  auth: Auth;
  /** Consecutive instances that came up without the SSO provider. */
  failures: number;
  /** Set when this instance lacks the SSO provider: the first call after it builds a new one. */
  retryAt: number | null;
  /** `app_settings.oidc.provider`'s `updated_at` this instance was built from; null: the env. */
  stamp: number | null;
  /** When that stamp was last re-read (see {@link settingsStamp}). */
  checkedAt: number;
}

const cache = globalThis as unknown as { ledgerlyAuth?: CachedAuth };

/**
 * Whether the saved provider has moved under this instance. Checked at most once every 30 s, and
 * the window is charged to the cached entry itself, so one busy worker does not read the row on
 * every request (plan F8 §3.4.4).
 */
async function providerChanged(cached: CachedAuth): Promise<boolean> {
  const now = Date.now();
  if (now - cached.checkedAt < SETTINGS_REVALIDATE_MS) return false;
  cached.checkedAt = now;
  return (await settingsStamp(OIDC_PROVIDER)) !== cached.stamp;
}

/** Drops the memoized instance, for the worker that has just saved the provider itself. */
export function invalidateAuth(): void {
  delete cache.ledgerlyAuth;
}

/**
 * The app-wide instance. `nextCookies()` lets Server Actions set the session cookie. An instance
 * whose identity-provider discovery failed still serves password sign-in, and is replaced after a
 * backoff (5 s, doubling, at most 5 min) so SSO recovers without a restart. It is also replaced
 * when Admin › Server saved a different provider, which every worker notices within 30 s.
 */
export async function getAuth(): Promise<Auth> {
  const cached = cache.ledgerlyAuth;
  if (
    cached &&
    (cached.retryAt === null || Date.now() < cached.retryAt) &&
    !(await providerChanged(cached))
  ) {
    return cached.auth;
  }
  const oidc = await oidcConfig();
  const entry: CachedAuth = {
    auth: createAuth({ withNextCookies: true, oidc }),
    failures: cached?.failures ?? 0,
    retryAt: null,
    stamp: oidc.updatedAt?.getTime() ?? null,
    checkedAt: Date.now(),
  };
  cache.ledgerlyAuth = entry;
  const degraded = () => {
    entry.failures += 1;
    entry.retryAt = Date.now() + Math.min(RETRY_BASE_MS * 2 ** (entry.failures - 1), RETRY_MAX_MS);
  };
  entry.auth.$context.then((ctx) => {
    if (ctx.socialProviders.some((provider) => provider.id === OIDC_PROVIDER_ID)) entry.failures = 0;
    else degraded();
  }, degraded);
  return entry.auth;
}
