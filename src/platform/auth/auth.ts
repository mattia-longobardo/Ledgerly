import "server-only";
import { hash, verify } from "@node-rs/argon2";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin, genericOAuth } from "better-auth/plugins";
import { count, eq } from "drizzle-orm";
import { getDb } from "@/platform/db/client";
import * as tables from "@/platform/db/tables";
import { readEnv } from "@/platform/env";
import { OIDC_PROVIDER_ID } from "./provider";
import { roleFromIdToken } from "./roles";
import { users } from "./schema";

// OWASP argon2id parameters; @node-rs/argon2 uses argon2id by default.
const ARGON2 = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

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

export function createAuth({ withNextCookies }: { withNextCookies: boolean }) {
  const env = readEnv();
  return betterAuth({
    appName: "Finance Dashboard",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.BETTER_AUTH_URL],
    database: drizzleAdapter(getDb(), { provider: "pg", schema: tables }),
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
    account: { modelName: "authAccounts" },
    verification: { modelName: "verifications" },
    advanced: {
      // Postgres generates every id (`DEFAULT uuidv7()`, spec §4.3); Better Auth inserts none.
      database: { generateId: false },
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      autoSignIn: true,
      revokeSessionsOnPasswordReset: true,
      password: {
        hash: (password) => hash(password, ARGON2),
        verify: ({ hash: stored, password }) => verify(stored, password),
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
      },
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
      admin({ defaultRole: "user", adminRoles: ["admin"] }),
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
      ...(withNextCookies ? [nextCookies()] : []),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const cache = globalThis as unknown as { financeAuth?: Auth };

/** The app-wide instance. `nextCookies()` lets Server Actions set the session cookie. */
export function getAuth(): Auth {
  cache.financeAuth ??= createAuth({ withNextCookies: true });
  return cache.financeAuth;
}
