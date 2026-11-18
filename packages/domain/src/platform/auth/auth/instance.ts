import { OIDC_PROVIDER, oidcConfig, SETTINGS_REVALIDATE_MS, settingsStamp } from "../../settings/config";
import { OIDC_PROVIDER_ID } from "../provider";
import { createAuth } from "./create";
import { RETRY_BASE_MS, RETRY_MAX_MS } from "./settings";

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
