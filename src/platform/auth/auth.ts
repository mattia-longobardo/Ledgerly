import "server-only";
import { hash, verify } from "@node-rs/argon2";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { admin, genericOAuth } from "better-auth/plugins";
import { count, eq } from "drizzle-orm";
import { getDb } from "@/platform/db/client";
import * as tables from "@/platform/db/tables";
import { readEnv } from "@/platform/env";
import { sendMail } from "@/platform/mail";
import { hasSsoAccount } from "./accounts";
import { passwordResetEmail } from "./emails";
import { authLogger, redactForLog } from "./logger";
import { nameSchema } from "./name-policy";
import { accessControl, roles } from "./permissions";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "./password-policy";
import { OIDC_PROVIDER_ID } from "./provider";
import { roleFromIdToken } from "./roles";
import { users } from "./schema";

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
  const role = roleFromIdToken(account.idToken, readEnv().OIDC_ADMIN_GROUP);
  if (role) await getDb().update(users).set({ role }).where(eq(users.id, account.userId));
}

async function noUsersYet(): Promise<boolean> {
  const [row] = await getDb().select({ n: count() }).from(users);
  return (row?.n ?? 0) === 0;
}

type OidcPlugin = ReturnType<typeof genericOAuth>;

/**
 * genericOAuth fetches the discovery document once, while Better Auth initializes, and 1.7.4
 * gives that fetch no timeout or signal. Past the deadline the provider is left out, exactly as on
 * a failed fetch, and getAuth() retries later; the abandoned fetch settles on its own.
 */
function withDiscoveryDeadline(plugin: OidcPlugin): OidcPlugin {
  return {
    ...plugin,
    init: async (ctx) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<Awaited<ReturnType<OidcPlugin["init"]>>>((resolve) => {
        timer = setTimeout(() => {
          ctx.logger.error(`Discovery for "${OIDC_PROVIDER_ID}" timed out after ${DISCOVERY_TIMEOUT_MS} ms`);
          resolve({ context: { socialProviders: ctx.socialProviders } });
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

export function createAuth({ withNextCookies }: { withNextCookies: boolean }) {
  const env = readEnv();
  return betterAuth({
    appName: "Finance Dashboard",
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
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
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
      // Fire and forget: the response time must not reveal whether the address exists.
      sendResetPassword: async ({ user, url }) => {
        const hours = RESET_PASSWORD_TOKEN_TTL_SECONDS / 3600;
        void sendMail({ to: user.email, ...passwordResetEmail(url, hours) }).catch((error: unknown) => {
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
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
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
              message: "Enter a name between 1 and 120 characters.",
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
      withDiscoveryDeadline(
        genericOAuth({
          config: [
            {
              providerId: OIDC_PROVIDER_ID,
              name: "Authentik",
              clientId: env.OIDC_CLIENT_ID,
              clientSecret: env.OIDC_CLIENT_SECRET,
              discoveryUrl: env.OIDC_DISCOVERY_URL,
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
}

const cache = globalThis as unknown as { financeAuth?: CachedAuth };

/**
 * The app-wide instance. `nextCookies()` lets Server Actions set the session cookie. An instance
 * whose identity-provider discovery failed still serves password sign-in, and is replaced after a
 * backoff (5 s, doubling, at most 5 min) so SSO recovers without a restart.
 */
export function getAuth(): Auth {
  const cached = cache.financeAuth;
  if (cached && (cached.retryAt === null || Date.now() < cached.retryAt)) return cached.auth;
  const entry: CachedAuth = {
    auth: createAuth({ withNextCookies: true }),
    failures: cached?.failures ?? 0,
    retryAt: null,
  };
  cache.financeAuth = entry;
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
