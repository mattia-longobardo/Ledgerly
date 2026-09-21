import "server-only";
import { eq } from "drizzle-orm";
import { type KeyRing, openJson, parseKeyRing } from "@/platform/crypto";
import { getDb } from "@/platform/db/client";
import { readEnv } from "@/platform/env";
import { discoveryUrlFor, issuerFromDiscoveryUrl } from "./oidc";
import { appSettings } from "./schema";
import { type Encryption, encryptionFrom, type MailCategory, type MailPolicy, mailPolicyFrom } from "./smtp";

/**
 * The effective server settings: what the processes that *use* them read, as opposed to what an
 * admin sees and edits (`./service.ts`).
 *
 * Two rules hold everywhere in this file (plan F8 §3.4.3): the environment is the initial value and
 * is never erased, and a saved setting wins over it. An instance that has only `.env.homelab`
 * behaves exactly as it did before F8.
 */

/** One row per server-level setting (spec §6); each key is read by primary key, never scanned. */
export const LLM_FALLBACK = "llm.fallback";
export const OIDC_PROVIDER = "oidc.provider";
/** The last "Test connection" verdict, kept apart so recording it does not restart Better Auth. */
export const OIDC_PROBE = "oidc.probe";
export const SMTP_TRANSPORT = "smtp.transport";

let ring: KeyRing | undefined;

/** The key ring of spec §9.4, parsed once: the first key seals, every key still opens. */
export function keyRing(): KeyRing {
  ring ??= parseKeyRing(readEnv().APP_ENCRYPTION_KEY);
  return ring;
}

export interface SettingsRow {
  value: Record<string, unknown> | null;
  sealed: Buffer | null;
  updatedAt: Date;
}

/** One settings row, or null. */
export async function readSetting(key: string): Promise<SettingsRow | null> {
  const [row] = await getDb()
    .select({ value: appSettings.value, sealed: appSettings.sealed, updatedAt: appSettings.updatedAt })
    .from(appSettings)
    .where(eq(appSettings.key, key));
  return row ?? null;
}

/**
 * When a key was last written, as a number, or null when no row exists.
 *
 * This is the whole of the freshness protocol of plan F8 §3.4.4: Better Auth and the mail
 * transport are memoized per process, a save happens in **one** process, and there is no channel
 * between them. Each holds the stamp of the row it was built from and re-reads it at most every
 * {@link SETTINGS_REVALIDATE_MS}; whoever saves invalidates its own copy straight away. The cost is
 * one primary-key read per 30 s per process; the price is up to 30 s of lag on the other workers.
 * That is deliberate, not an oversight.
 */
export async function settingsStamp(key: string): Promise<number | null> {
  const [row] = await getDb()
    .select({ updatedAt: appSettings.updatedAt })
    .from(appSettings)
    .where(eq(appSettings.key, key));
  return row ? row.updatedAt.getTime() : null;
}

export const SETTINGS_REVALIDATE_MS = 30_000;

/** A per-process value built from one settings key, rebuilt when that key changes. */
export function settingsBacked<T>(key: string, build: () => Promise<T>) {
  let cached: { value: T; stamp: number | null } | undefined;
  let checkedAt = 0;
  return {
    async get(): Promise<T> {
      const now = Date.now();
      if (cached && now - checkedAt < SETTINGS_REVALIDATE_MS) return cached.value;
      const stamp = await settingsStamp(key);
      checkedAt = now;
      if (cached && cached.stamp === stamp) return cached.value;
      cached = { value: await build(), stamp };
      return cached.value;
    },
    /** Called by whoever saved the key, so its own process does not wait out the window. */
    invalidate(): void {
      cached = undefined;
      checkedAt = 0;
    },
  };
}

/* Authentik (spec §5.1) */

export interface OidcConfig {
  issuer: string;
  discoveryUrl: string;
  clientId: string;
  clientSecret: string;
  adminGroup: string;
  /** null when every field came from the environment: nothing has been saved yet. */
  updatedAt: Date | null;
}

export function oidcFromEnv(): OidcConfig {
  const env = readEnv();
  return {
    issuer: issuerFromDiscoveryUrl(env.OIDC_DISCOVERY_URL),
    discoveryUrl: env.OIDC_DISCOVERY_URL,
    clientId: env.OIDC_CLIENT_ID,
    clientSecret: env.OIDC_CLIENT_SECRET,
    adminGroup: env.OIDC_ADMIN_GROUP,
    updatedAt: null,
  };
}

/**
 * The provider Better Auth is built from. A saved row replaces the environment as a whole — an
 * issuer from the screen with a client id from the environment would be a configuration nobody
 * chose — except for the sealed secret, which an admin may leave untouched when saving.
 */
export async function oidcConfig(): Promise<OidcConfig> {
  const row = await readSetting(OIDC_PROVIDER);
  const fromEnv = oidcFromEnv();
  if (!row?.value?.issuer) return fromEnv;
  const issuer = String(row.value.issuer);
  const secret = row.sealed ? openJson(keyRing(), row.sealed).clientSecret : undefined;
  return {
    issuer,
    discoveryUrl: discoveryUrlFor(issuer),
    clientId: String(row.value.clientId ?? fromEnv.clientId),
    clientSecret: secret || fromEnv.clientSecret,
    adminGroup: String(row.value.adminGroup ?? fromEnv.adminGroup),
    updatedAt: row.updatedAt,
  };
}

/* Outgoing mail (spec §9.4) */

export interface SmtpConfig {
  host: string;
  port: number;
  encryption: Encryption;
  user: string | null;
  password: string | null;
  from: string;
  updatedAt: Date | null;
}

export function smtpFromEnv(): SmtpConfig {
  const env = readEnv();
  return {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    encryption: encryptionFrom({ secure: env.SMTP_SECURE, requireTLS: env.SMTP_REQUIRE_TLS }),
    user: env.SMTP_USER ?? null,
    password: env.SMTP_PASSWORD ?? null,
    from: env.MAIL_FROM,
    updatedAt: null,
  };
}

export async function smtpConfig(): Promise<SmtpConfig> {
  const row = await readSetting(SMTP_TRANSPORT);
  const fromEnv = smtpFromEnv();
  if (!row?.value?.host) return fromEnv;
  const user = String(row.value.user ?? "");
  const password = row.sealed ? openJson(keyRing(), row.sealed).password : undefined;
  return {
    host: String(row.value.host),
    port: Number(row.value.port),
    encryption: String(row.value.encryption ?? "none") as Encryption,
    user: user || null,
    password: password || (user ? null : fromEnv.password),
    from: String(row.value.from ?? fromEnv.from),
    updatedAt: row.updatedAt,
  };
}

/** The three switches of the SMTP card, defaulting to on while nothing is saved. */
export async function mailPolicy(): Promise<MailPolicy> {
  return mailPolicyFrom((await readSetting(SMTP_TRANSPORT))?.value);
}

/** Whether a whole category of mail may leave this instance at all (plan F8 §3.4.6). */
export async function mailAllowed(category: MailCategory): Promise<boolean> {
  return (await mailPolicy())[category];
}
