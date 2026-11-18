import { genericOAuth } from "better-auth/plugins";
import { count, eq } from "drizzle-orm";
import { getPreferences } from "../../../modules/users/service";
import { getDb } from "../../db/client";
import { readEnv } from "../../env";
import { sendMail } from "../../mail";
import { mailAllowed, oidcConfig } from "../../settings/config";
import { hasPasswordAccount } from "../accounts";
import { passwordResetEmail } from "../emails";
import { OIDC_PROVIDER_ID } from "../provider";
import { roleFromIdToken } from "../roles";
import { users } from "../schema";
import { twoFactorSetupRequired } from "../two-factor-policy";

export const RESET_PASSWORD_TOKEN_TTL_SECONDS = 60 * 60;

// OWASP argon2id parameters; @node-rs/argon2 uses argon2id by default.
export const ARGON2 = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

/** Endpoints that would accept a bare ID token instead of the redirect flow (PKCE, state, nonce). */
export const ID_TOKEN_PATHS = new Set(["/sign-in/social", "/link-social"]);

const DISCOVERY_TIMEOUT_MS = 5_000;
export const RETRY_BASE_MS = 5_000;
export const RETRY_MAX_MS = 5 * 60_000;

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
export async function sendPasswordResetEmail(
  user: { id: string; email: string },
  url: string,
): Promise<void> {
  // "Invitations & resets", off, means the reset link does not leave either (plan F8 §3.4.6):
  // it is the one switch that can lock a person out, and the SMTP card says so beside it.
  if (!(await mailAllowed("invitations"))) return;
  if (!(await hasPasswordAccount(user.id))) return;
  const { locale } = await getPreferences({ userId: user.id });
  const hours = RESET_PASSWORD_TOKEN_TTL_SECONDS / 3600;
  await sendMail({ to: user.email, ...passwordResetEmail(url, hours, locale) });
}

/** The TOTP setup still owed under TWO_FACTOR_POLICY=required (see `session.ts`). */
export async function setupPending(user: {
  id: string;
  twoFactorEnabled?: boolean | null;
}): Promise<boolean> {
  const policy = readEnv().TWO_FACTOR_POLICY;
  const twoFactorEnabled = user.twoFactorEnabled === true;
  if (policy !== "required" || twoFactorEnabled) return false;
  return twoFactorSetupRequired({ policy, twoFactorEnabled, hasPassword: await hasPasswordAccount(user.id) });
}

export async function noUsersYet(): Promise<boolean> {
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
export const TWO_FACTOR_RATE_LIMIT = { window: 60, max: 5 } as const;

/**
 * The client-management endpoints of the OAuth provider. A person manages their "Client API" in
 * Settings › Security, whose Server Actions call these through `auth.api`; over HTTP they answer
 * 403, so a client can only ever be created with the scopes and grant that screen allows.
 */
export const SERVER_ONLY_OAUTH_PATHS = new Set([
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
export const SESSION_OAUTH_PATHS = new Set(["/oauth2/authorize", "/oauth2/consent", "/oauth2/continue"]);

/** RFC 7591 registration: open (MCP clients register themselves), a few a minute per client. */
export const REGISTER_RATE_LIMIT = { window: 60, max: 5 } as const;

/**
 * genericOAuth fetches the discovery document once, while Better Auth initializes, and 1.7.14
 * still gives that startup fetch no timeout or signal (only its per-request retry has one). Past
 * the deadline the provider is left out and marked pending, exactly as on a failed fetch: the
 * plugin retries discovery on the next Authentik sign-in, and getAuth() rebuilds the instance after
 * its backoff. The abandoned fetch settles on its own.
 */
export function withDiscoveryDeadline(plugin: OidcPlugin): OidcPlugin {
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
